// ===== AUDIO ENGINE =====
// Handles Tone.js context, synth layers, sample-based playback, and effects chain.
// Uses the global `Tone` object (loaded via <script> tag before this module).

import { NOTE_NAMES } from './music-theory.js';
import { PRESETS } from './sound-presets.js';

// ---- State ----
let synthLayers = [];
let reverb = null;
let compressor = null;
let audioReady = false;
let pendingPlay = null;
let rawCtx = null;

// Sampler state
let samplers = {};          // { piano: Tone.Sampler, guitar: Tone.Sampler, ukulele: Tone.Sampler }
let samplerReady = {};      // { piano: false, guitar: false, ... }
let samplerReverb = null;   // Tone.Reverb (convolution) — only on https://
let samplerCompressor = null;
let currentInstrument = 'piano'; // tracks which instrument to route playback through

// Loading callback (set by UI)
let onLoadProgress = null;

// ---- Sample definitions ----
// Using nbrosowsky/tonejs-instruments on GitHub Pages
const SAMPLE_BASE = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

// Sparse sample maps — Tone.Sampler interpolates the gaps
const SAMPLE_MAPS = {
  piano: {
    url: SAMPLE_BASE + 'piano/',
    notes: {
      'A1': 'A1.mp3', 'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3', 'A5': 'A5.mp3',
      'C2': 'C2.mp3', 'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3', 'C6': 'C6.mp3',
      'E2': 'E2.mp3', 'E3': 'E3.mp3', 'E4': 'E4.mp3', 'E5': 'E5.mp3',
    },
  },
  guitar: {
    url: SAMPLE_BASE + 'guitar-acoustic/',
    notes: {
      'A2': 'A2.mp3', 'A3': 'A3.mp3', 'A4': 'A4.mp3',
      'C3': 'C3.mp3', 'C4': 'C4.mp3', 'C5': 'C5.mp3',
      'E2': 'E2.mp3', 'E3': 'E3.mp3', 'E4': 'E4.mp3',
      'G2': 'G2.mp3', 'G3': 'G3.mp3', 'G4': 'G4.mp3',
    },
  },
  // Ukulele reuses the guitar-nylon sampler (loaded once, shared).
  // Playback pitches notes up an octave + shorter duration for uke character.
  ukulele: null, // signals "reuse guitar-nylon"
};

// ---- Public API ----

export function isAudioReady() { return audioReady; }

export function setLoadProgressCallback(cb) { onLoadProgress = cb; }

export function setCurrentInstrument(inst) {
  currentInstrument = inst;
  // Ukulele shares the guitar-nylon sampler
  const loadTarget = inst === 'ukulele' ? 'guitar' : inst;
  if (audioReady && !samplerReady[loadTarget] && !samplers[loadTarget]) {
    loadSampler(loadTarget);
  }
}

// Step 1: Create AudioContext synchronously on ANY user gesture (Android requirement)
export function ensureContext() {
  if (rawCtx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    rawCtx = new AC();
    if (rawCtx.state === 'suspended') rawCtx.resume();
  } catch (e) {
    console.warn('AudioContext creation failed:', e);
  }
}

// Step 2: Build synths using the context we already created
export function finishAudioSetup() {
  if (audioReady) return true; // already set up
  if (!rawCtx) ensureContext();
  if (!rawCtx) return false;

  try {
    Tone.setContext(rawCtx);
    if (rawCtx.state === 'suspended') rawCtx.resume();
    initSynthLayers();
    audioReady = true;

    // Start loading samples for current instrument in background
    // Ukulele shares guitar-nylon, so load that instead
    const loadTarget = currentInstrument === 'ukulele' ? 'guitar' : currentInstrument;
    loadSampler(loadTarget);

    return true; // success
  } catch (e) {
    console.error('Audio setup failed:', e);
    audioReady = false;
    rawCtx = null;
    return false; // failure
  }
}

// Attach to EVERY user gesture type — create context synchronously, build synths after
export function onUserGesture() {
  ensureContext();
  if (!audioReady) {
    finishAudioSetup();
  } else if (rawCtx && rawCtx.state === 'suspended') {
    rawCtx.resume();
  }
  // Fire any pending play
  if (audioReady && pendingPlay) {
    const semis = pendingPlay;
    pendingPlay = null;
    doPlayNotes(semis);
  }
}

// Public play — handles unlock flow
export function playNotes(semis) {
  if (!audioReady) {
    pendingPlay = semis;
    ensureContext();
    finishAudioSetup();
    if (audioReady) {
      pendingPlay = null;
      doPlayNotes(semis);
    }
    return;
  }
  doPlayNotes(semis);
}

// ---- Sound parameter updates ----

export function applySoundParams(params) {
  const { rv, dc, at, su, rl, br, wm, sb } = params;
  if (!audioReady) return;

  // Reverb
  reverb.wet.value = rv / 100;
  reverb.roomSize.value = 0.2 + (dc / 100) * 0.75;

  const attackSec = Math.max(0.002, at / 100);
  const sustainVal = su / 100;
  const releaseSec = Math.max(0.1, rl / 10);

  // Body layer
  const body = synthLayers._body;
  if (body) {
    body.set({
      envelope: { attack: attackSec, sustain: sustainVal, release: releaseSec },
      oscillator: { spread: 2 + (wm / 100) * 34 }
    });
  }

  // Bright layer
  const bright = synthLayers._bright;
  if (bright) {
    bright.volume.value = br === 0 ? -Infinity : -30 + (br / 100) * 18;
  }

  // Sub layer
  const sub = synthLayers._sub;
  if (sub) {
    sub.volume.value = sb === 0 ? -Infinity : -30 + (sb / 100) * 16;
    sub.set({ envelope: { attack: attackSec * 1.2, sustain: sustainVal * 0.8, release: releaseSec * 0.9 } });
  }

  // Chorus warmth
  const pianoChorus = synthLayers._pianoChorus;
  if (pianoChorus) {
    pianoChorus.depth = 0.08 + (wm / 100) * 0.52;
  }
}

// ---- Internal ----

function initSynthLayers() {
  // Effects chain: Synths -> Chorus -> Compressor -> Reverb -> Destination
  // On https:// we can use Tone.Reverb (convolution). On file://, use Freeverb.
  const isSecure = window.location.protocol === 'https:';

  reverb = new Tone.Freeverb({ roomSize: 0.55, dampening: 3500, wet: 0.28 }).toDestination();
  compressor = new Tone.Compressor({ threshold: -16, ratio: 3.5, attack: 0.008, release: 0.12 }).connect(reverb);

  // If on HTTPS, also create a convolution reverb that will replace Freeverb once ready
  if (isSecure) {
    try {
      samplerReverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: 0.28 });
      samplerReverb.generate().then(() => {
        samplerReverb.toDestination();
        samplerCompressor = new Tone.Compressor({ threshold: -16, ratio: 3.5, attack: 0.008, release: 0.12 }).connect(samplerReverb);
      }).catch(() => {
        // Fall back to algorithmic reverb
        samplerReverb = null;
      });
    } catch (e) {
      samplerReverb = null;
    }
  }

  // Piano chorus
  const pianoChorus = new Tone.Chorus({ rate: 0.45, delayTime: 3.5, depth: 0.32, feedback: 0.06, wet: 0.38 }).connect(compressor);
  pianoChorus.start();
  synthLayers._pianoChorus = pianoChorus;

  // Body: richer harmonic series
  const body = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: { type: 'fatcustom', partials: [1, 0.48, 0.22, 0.07, 0.025], spread: 11, count: 3 },
    envelope: { attack: 0.018, decay: 1.1, sustain: 0.16, release: 2.4 },
    volume: -11
  }).connect(pianoChorus);

  // Bright: hammer transient
  const bright = new Tone.PolySynth(Tone.FMSynth, {
    maxPolyphony: 16,
    harmonicity: 4,
    modulationIndex: 1.2,
    oscillator: { type: 'sine' },
    modulation: { type: 'sine' },
    envelope: { attack: 0.003, decay: 0.28, sustain: 0.0, release: 0.6 },
    modulationEnvelope: { attack: 0.001, decay: 0.09, sustain: 0.0, release: 0.18 },
    volume: -20
  }).connect(pianoChorus);

  // Sub: bass foundation — bypasses chorus
  const sub = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.028, decay: 1.3, sustain: 0.12, release: 2.1 },
    volume: -21
  }).connect(compressor);

  synthLayers = [body, bright, sub];
  synthLayers._body = body;
  synthLayers._bright = bright;
  synthLayers._sub = sub;
}

function loadSampler(instrument) {
  if (samplers[instrument] || samplerReady[instrument]) return;

  const config = SAMPLE_MAPS[instrument];
  if (!config) return;

  if (onLoadProgress) {
    onLoadProgress(instrument, 'loading', 0);
  }

  // Build note map with full URLs
  const noteMap = {};
  for (const [note, file] of Object.entries(config.notes)) {
    noteMap[note] = config.url + file;
  }

  try {
    const sampler = new Tone.Sampler({
      urls: config.notes,
      baseUrl: config.url,
      onload: () => {
        samplerReady[instrument] = true;
        // Connect to the convolution reverb chain if available, otherwise to the synth chain
        const dest = samplerCompressor || compressor;
        sampler.connect(dest);
        if (onLoadProgress) {
          onLoadProgress(instrument, 'ready', 100);
        }
      },
      onerror: (err) => {
        console.warn(`Failed to load ${instrument} samples:`, err);
        // Mark as attempted so we don't retry endlessly
        samplers[instrument] = null;
        if (onLoadProgress) {
          onLoadProgress(instrument, 'error', 0);
        }
      }
    });

    samplers[instrument] = sampler;
  } catch (e) {
    console.warn(`Sample loading failed for ${instrument}:`, e);
  }
}

// MIDI number to Tone.js note name
function midiToNoteName(midi) {
  const oct = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + oct;
}

// Internal play — assumes audio is ready
function doPlayNotes(semis) {
  if (rawCtx && rawCtx.state === 'suspended') {
    rawCtx.resume();
  }

  // Build note names with proper voicing
  // Ukulele: pitch up an octave (C5 base instead of C4) for bright uke character
  const isUke = currentInstrument === 'ukulele';
  const baseMidi = isUke ? 72 : 60; // C5 for uke, C4 for others
  const duration = isUke ? '4n' : '1.5n'; // shorter sustain for uke pluck

  const toneNotes = [];
  let lastMidi = -1;
  semis.forEach((s) => {
    let midi = baseMidi + (s % 12);
    if (midi <= lastMidi) midi += 12;
    lastMidi = midi;
    toneNotes.push(midiToNoteName(midi));
  });

  // Resolve sampler — ukulele shares the guitar sampler
  const samplerKey = isUke ? 'guitar' : currentInstrument;
  if (samplerReady[samplerKey] && samplers[samplerKey]) {
    const sampler = samplers[samplerKey];
    sampler.releaseAll();
    toneNotes.forEach(note => {
      sampler.triggerAttackRelease(note, duration);
    });
  } else {
    // Fall back to synth layers
    synthLayers.forEach(layer => {
      if (typeof layer.releaseAll === 'function') {
        layer.releaseAll();
        layer.triggerAttackRelease(toneNotes, '1.5n');
      }
    });
  }
}

// Check if sampler is loaded for an instrument
export function isSamplerReady(instrument) {
  if (instrument === 'ukulele') return !!samplerReady['guitar'];
  return !!samplerReady[instrument];
}
