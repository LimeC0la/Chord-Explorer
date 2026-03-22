/**
 * listener-ui.js
 *
 * Main listener controller — ties together MicManager, YIN, NoteAccumulator,
 * and ChordMatcher with a requestAnimationFrame loop, and renders the
 * listener panel UI.
 */

import { MicManager } from './mic-manager.js';
import { yin } from './yin.js';
import { NoteAccumulator } from './note-accumulator.js';
import { ChordMatcher } from './chord-matcher.js';
import { NOTE_NAMES, ROOTS, chordSymbol, chordNoteNames } from '../music-theory.js';
import { navigateToChord } from '../ui.js';

/* ── Module-level state ────────────────────────────────────── */

let micManager = null;
let accumulator = null;
let matcher = null;
let animFrameId = null;
let lastUpdateTime = 0;
const UPDATE_DEBOUNCE = 150; // ms — prevent flickery display
let analyserBuffer = null;   // Float32Array, reused for time-domain
let freqBuffer = null;       // Float32Array, reused for FFT
let currentMatch = null;     // Last displayed match
let panelExpanded = false;   // Collapse state

// Amplitude gate — ignore signals quieter than this (filters out speech/ambient)
const AMP_GATE = 0.04;

/* ── Public API ────────────────────────────────────────────── */

/**
 * Render the listener panel HTML into #listener-area.
 */
export function renderListenerPanel() {
  const container = document.getElementById('listener-area');
  if (!container) return;

  container.innerHTML = `
    <div class="listener-panel" id="listener-panel">
      <div class="listener-header" data-listener-action="toggle-listener-panel">
        <span class="listener-header-title">\uD83C\uDFA4 Chord Listener</span>
        <span class="listener-header-arrow" id="listener-arrow">\u25BC</span>
      </div>
      <div class="listener-body" id="listener-body" style="display:none;">
        <button class="mic-btn" id="listener-mic-btn" data-listener-action="toggle-mic">
          \uD83C\uDFA4 Start Listening
        </button>

        <div class="listener-level-bar" id="listener-level-bar">
          <div class="listener-level-fill" id="listener-level-fill"></div>
          <div class="listener-level-gate" style="left:${Math.round(AMP_GATE * 100 / 0.3)}%"
               title="Minimum level to detect"></div>
        </div>

        <div id="listener-result" class="listener-result">
          <p class="listener-hint">Play a chord and I'll try to identify it</p>
        </div>

        <button class="apply-btn" id="listener-apply-btn"
                data-listener-action="apply-detected-chord" disabled>
          Apply to Explorer
        </button>

        <p class="listener-footer">Works with your instrument or any audio source</p>
      </div>
    </div>`;
}

/**
 * Toggle the panel body visibility.
 */
export function toggleListenerPanel() {
  panelExpanded = !panelExpanded;

  const body = document.getElementById('listener-body');
  const arrow = document.getElementById('listener-arrow');
  if (body) body.style.display = panelExpanded ? '' : 'none';
  if (arrow) arrow.textContent = panelExpanded ? '\u25B2' : '\u25BC';
}

/**
 * Start or stop the microphone and detection loop.
 */
export async function toggleMic() {
  const btn = document.getElementById('listener-mic-btn');

  // ── Stop ──
  if (micManager && micManager.isActive()) {
    if (animFrameId != null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    micManager.stop();
    if (accumulator) accumulator.reset();

    if (btn) {
      btn.textContent = '\uD83C\uDFA4 Start Listening';
      btn.classList.remove('listening');
    }
    currentMatch = null;
    const result = document.getElementById('listener-result');
    if (result) {
      result.innerHTML = '<p class="listener-hint">Play a chord and I\'ll try to identify it</p>';
    }
    const applyBtn = document.getElementById('listener-apply-btn');
    if (applyBtn) applyBtn.disabled = true;
    return;
  }

  // ── Start ──
  if (!micManager) micManager = new MicManager();
  if (!accumulator) accumulator = new NoteAccumulator();
  if (!matcher) matcher = new ChordMatcher();

  try {
    await micManager.start();
  } catch (err) {
    const result = document.getElementById('listener-result');
    if (result) {
      result.innerHTML = `<p class="listener-error">${err.message}</p>`;
    }
    return;
  }

  const fftSize = micManager.getAnalyser().fftSize;
  analyserBuffer = new Float32Array(fftSize);
  freqBuffer = new Float32Array(micManager.getAnalyser().frequencyBinCount);
  lastUpdateTime = 0;

  if (btn) {
    btn.textContent = '\u23F9 Stop Listening';
    btn.classList.add('listening');
  }

  const result = document.getElementById('listener-result');
  if (result) {
    result.innerHTML = '<p class="listener-hint">Listening\u2026</p>';
  }

  listenLoop();
}

/**
 * If a chord has been detected, navigate the explorer to it.
 */
export function applyDetectedChord() {
  if (currentMatch) {
    navigateToChord(currentMatch.rootIdx, currentMatch.typeIdx);
  }
}

/**
 * Route a click action from the panel's data-action attributes.
 * @param {string} action
 */
export function handleListenerClick(action) {
  switch (action) {
    case 'toggle-listener-panel':
      toggleListenerPanel();
      break;
    case 'toggle-mic':
      toggleMic();
      break;
    case 'apply-detected-chord':
      applyDetectedChord();
      break;
  }
}

/* ── Internal helpers ──────────────────────────────────────── */

/**
 * Compute RMS amplitude of the time-domain buffer.
 */
function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * FFT-based peak detection — finds multiple simultaneous pitches.
 * Returns an array of MIDI note numbers from spectral peaks.
 */
function fftPeaks(freqData, sampleRate, binCount) {
  const peaks = [];
  const hzPerBin = sampleRate / (binCount * 2);

  // Only look at bins corresponding to ~75Hz–2000Hz
  const minBin = Math.floor(75 / hzPerBin);
  const maxBin = Math.min(Math.floor(2000 / hzPerBin), binCount - 2);

  // Find the noise floor (median amplitude)
  const sorted = [...freqData.slice(minBin, maxBin + 1)].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.5)];
  const peakThreshold = noiseFloor + 20; // Must be 20dB above noise floor

  for (let i = minBin + 1; i < maxBin; i++) {
    // Local maximum and above threshold
    if (freqData[i] > freqData[i - 1] &&
        freqData[i] > freqData[i + 1] &&
        freqData[i] > peakThreshold) {
      // Parabolic interpolation for accurate frequency
      const a = freqData[i - 1];
      const b = freqData[i];
      const c = freqData[i + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c));
      const freq = (i + (isFinite(shift) ? shift : 0)) * hzPerBin;

      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      if (midi >= 28 && midi <= 96) {
        // Avoid duplicate pitch classes from harmonics
        const pc = midi % 12;
        if (!peaks.some(p => p % 12 === pc)) {
          peaks.push(midi);
        }
      }
    }
  }

  return peaks;
}

/**
 * requestAnimationFrame-driven detection loop.
 *
 * Uses two detection methods:
 * 1. YIN — excellent for single dominant pitches
 * 2. FFT peak detection — catches multiple simultaneous notes (chords)
 *
 * An amplitude gate ignores quiet signals (speech, ambient noise).
 */
function listenLoop() {
  if (!micManager || !micManager.isActive()) return;

  const analyser = micManager.getAnalyser();
  const sr = micManager.getSampleRate();

  // Read time-domain data
  analyser.getFloatTimeDomainData(analyserBuffer);

  // Amplitude gate — skip if the signal is too quiet
  const amplitude = rms(analyserBuffer);

  // Update the level meter
  const levelFill = document.getElementById('listener-level-fill');
  if (levelFill) {
    const pct = Math.min(amplitude / 0.3, 1) * 100;  // Normalise to 0-100%
    levelFill.style.width = pct + '%';
    levelFill.className = 'listener-level-fill' + (amplitude >= AMP_GATE ? ' active' : '');
  }

  if (amplitude >= AMP_GATE) {
    const now = performance.now();

    // Method 1: YIN for dominant pitch
    const detection = yin(analyserBuffer, sr);
    if (detection && detection.confidence > 0.85) {
      const midi = Math.round(12 * Math.log2(detection.frequency / 440) + 69);
      if (midi >= 28 && midi <= 96) {
        accumulator.addDetection(midi, detection.confidence, now);
      }
    }

    // Method 2: FFT peaks for polyphonic content
    analyser.getFloatFrequencyData(freqBuffer);
    const peaks = fftPeaks(freqBuffer, sr, analyser.frequencyBinCount);
    for (const midi of peaks) {
      accumulator.addDetection(midi, 0.7, now); // Slightly lower confidence than YIN
    }
  }

  // Update display periodically
  const now = performance.now();
  if (now - lastUpdateTime > UPDATE_DEBOUNCE) {
    const activeNotes = accumulator.getActiveNotes();
    if (activeNotes.size >= 2) {
      const match = matcher.match(activeNotes);
      updateDisplay(match, activeNotes);
    } else if (activeNotes.size === 0) {
      updateDisplay(null, activeNotes);
    }
    // If size is 1, keep showing previous result (might be mid-strum)
    lastUpdateTime = now;
  }

  animFrameId = requestAnimationFrame(listenLoop);
}

/**
 * Build a star string for the given confidence level (0-4).
 * @param {number} confidence
 * @returns {string}
 */
function confidenceStars(confidence) {
  return '\u2605'.repeat(confidence) + '\u2606'.repeat(4 - confidence);
}

/**
 * Update the #listener-result element with the current detection state.
 * @param {object|null} match    - ChordMatcher result or null
 * @param {Set<number>}  activeNotes - Currently sounding pitch classes
 */
function updateDisplay(match, activeNotes) {
  const result = document.getElementById('listener-result');
  const applyBtn = document.getElementById('listener-apply-btn');
  if (!result) return;

  if (!match) {
    currentMatch = null;
    if (applyBtn) applyBtn.disabled = true;
    result.innerHTML = '<p class="listener-hint">Listening\u2026</p>';
    return;
  }

  currentMatch = match;
  if (applyBtn) applyBtn.disabled = false;

  const symbol = chordSymbol(match.rootIdx, match.typeIdx);
  const notes = chordNoteNames(match.rootIdx, match.typeIdx);
  const stars = confidenceStars(match.confidence);

  // Pitch classes heard, mapped to note names
  const heardNames = [...activeNotes].sort((a, b) => a - b)
    .map(pc => NOTE_NAMES[pc]);

  // Alternate match display
  let altHtml = '';
  if (match.altMatch) {
    const altSymbol = chordSymbol(match.altMatch.rootIdx, match.altMatch.typeIdx);
    altHtml = `<div class="listener-alt">Closest alt: ${altSymbol}</div>`;
  }

  result.innerHTML = `
    <div class="listener-detected">
      <div class="listener-match-row">
        <span class="listener-chord-name">${symbol}</span>
        <span class="listener-stars">${stars}</span>
      </div>
      <div class="listener-notes">${notes.join(' \u2013 ')}</div>
      <div class="listener-heard">Notes heard: ${heardNames.join(' ')}</div>
      ${altHtml}
    </div>`;
}
