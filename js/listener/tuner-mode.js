/**
 * tuner-mode.js
 *
 * Real-time chromatic tuner using continuous YIN pitch detection.
 *
 * Reads time-domain data from an AnalyserNode every animation frame,
 * runs YIN to find the dominant pitch, and renders a live needle/gauge
 * display with note name, cents deviation, and frequency readout.
 *
 * Uses EMA smoothing on frequency to reduce jitter from frame-to-frame
 * YIN variance.
 */

import { yin } from './yin.js';

/* ── Constants ─────────────────────────────────────────────── */

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const YIN_THRESHOLD = 0.15;
const MIN_CONFIDENCE = 0.50;
const MIN_FREQUENCY  = 60;
const MAX_FREQUENCY  = 1500;
const EMA_ALPHA      = 0.35;      // smoothing factor (lower = smoother, slower)
const IN_TUNE_CENTS  = 5;         // ±cents to be "in tune"
const NO_SIGNAL_FRAMES = 15;      // frames with no pitch before dimming

/* ── Module state ──────────────────────────────────────────── */

let analyserNode    = null;  // tuner's own AnalyserNode (high smoothing)
let timeDomainBuf   = null;  // Float32Array for getFloatTimeDomainData
let rafId           = null;
let sampleRate      = 44100;
let running         = false;

// Smoothed state
let smoothedFreq    = 0;
let noSignalCount   = 0;

// DOM references (cached on start, avoid querySelectorAll per frame)
let elNote    = null;
let elOctave  = null;
let elNeedle  = null;
let elFreq    = null;
let elCents   = null;
let elMeter   = null;

// Callback for level meter updates
let levelCallback = null;

/* ── Public API ────────────────────────────────────────────── */

/**
 * Start the real-time tuner loop.
 *
 * @param {MicManager} micManager — must already be started
 * @param {HTMLElement} container — DOM element to render tuner into
 * @param {function} [onLevel] — called each frame with (rms: number)
 */
export function startTuner(micManager, container, onLevel) {
  if (running) return;

  sampleRate = micManager.getSampleRate();
  levelCallback = onLevel || null;

  // Create a tuner-specific analyser with higher smoothing for stability
  analyserNode = micManager.createAnalyserNode({
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
  });
  if (!analyserNode) return;

  timeDomainBuf = new Float32Array(analyserNode.fftSize);
  smoothedFreq = 0;
  noSignalCount = 0;

  // Build the DOM once
  container.innerHTML = _buildTunerHTML();

  // Cache DOM refs
  elNote   = document.getElementById('tuner-live-note');
  elOctave = document.getElementById('tuner-live-octave');
  elNeedle = document.getElementById('tuner-live-needle');
  elFreq   = document.getElementById('tuner-live-freq');
  elCents  = document.getElementById('tuner-live-cents');
  elMeter  = document.getElementById('tuner-live-meter');

  running = true;
  rafId = requestAnimationFrame(_tunerLoop);
}

/**
 * Stop the tuner loop and clean up.
 */
export function stopTuner() {
  running = false;
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (analyserNode) {
    try { analyserNode.disconnect(); } catch (_) {}
    analyserNode = null;
  }
  timeDomainBuf = null;
  levelCallback = null;
  elNote = elOctave = elNeedle = elFreq = elCents = elMeter = null;
}

/** @returns {boolean} */
export function isTunerRunning() {
  return running;
}

/* ── Core loop ─────────────────────────────────────────────── */

function _tunerLoop() {
  if (!running || !analyserNode) return;

  // Read time-domain samples from the mic
  analyserNode.getFloatTimeDomainData(timeDomainBuf);

  // Compute RMS for level meter
  let rmsSum = 0;
  for (let i = 0; i < timeDomainBuf.length; i++) {
    rmsSum += timeDomainBuf[i] * timeDomainBuf[i];
  }
  const rms = Math.sqrt(rmsSum / timeDomainBuf.length);
  if (levelCallback) levelCallback(rms);

  // Run YIN pitch detection
  const result = yin(timeDomainBuf, sampleRate, YIN_THRESHOLD);

  if (result &&
      result.confidence >= MIN_CONFIDENCE &&
      result.frequency >= MIN_FREQUENCY &&
      result.frequency <= MAX_FREQUENCY) {
    // Apply EMA smoothing
    if (smoothedFreq === 0) {
      smoothedFreq = result.frequency;
    } else {
      // If the note jumped more than a semitone, snap immediately
      const ratio = result.frequency / smoothedFreq;
      if (ratio > 1.06 || ratio < 0.94) {
        smoothedFreq = result.frequency;
      } else {
        smoothedFreq = EMA_ALPHA * result.frequency + (1 - EMA_ALPHA) * smoothedFreq;
      }
    }

    noSignalCount = 0;
    _renderPitch(smoothedFreq, result.confidence);
  } else {
    noSignalCount++;
    if (noSignalCount >= NO_SIGNAL_FRAMES) {
      _renderNoSignal();
      smoothedFreq = 0;
    }
  }

  rafId = requestAnimationFrame(_tunerLoop);
}

/* ── Rendering ─────────────────────────────────────────────── */

function _renderPitch(freq, confidence) {
  if (!elNote) return;

  const midiFloat   = 12 * Math.log2(freq / 440) + 69;
  const midi        = Math.round(midiFloat);
  const noteName    = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave      = Math.floor(midi / 12) - 1;
  const perfectFreq = 440 * Math.pow(2, (midi - 69) / 12);
  const cents       = 1200 * Math.log2(freq / perfectFreq);
  const centsRound  = Math.round(cents);

  // Note name + octave
  elNote.textContent = noteName;
  elOctave.textContent = octave;

  // Determine tuning state
  const absCents = Math.abs(centsRound);
  const inTune = absCents <= IN_TUNE_CENTS;

  elNote.classList.toggle('tuner-in-tune', inTune);
  elNote.classList.remove('tuner-no-signal');

  // Needle position: cents ranges from -50 to +50, map to 0%-100%
  const clampedCents = Math.max(-50, Math.min(50, cents));
  const pct = 50 + clampedCents;
  elNeedle.style.left = pct + '%';

  // Needle color: green when in tune, orange/red when off
  if (inTune) {
    elNeedle.style.background = '#4a9060';
  } else if (absCents < 20) {
    elNeedle.style.background = '#c0942a';
  } else {
    elNeedle.style.background = '#c05040';
  }

  // Frequency + cents readout
  elFreq.textContent = freq.toFixed(1) + ' Hz';
  if (centsRound === 0) {
    elCents.textContent = 'In tune';
    elCents.style.color = '#4a9060';
  } else {
    const sign = centsRound > 0 ? '+' : '';
    elCents.textContent = sign + centsRound + ' cents';
    elCents.style.color = inTune ? '#4a9060' : (absCents < 20 ? '#c0942a' : '#c05040');
  }
}

function _renderNoSignal() {
  if (!elNote) return;

  elNote.textContent = '--';
  elNote.classList.add('tuner-no-signal');
  elNote.classList.remove('tuner-in-tune');
  elOctave.textContent = '';
  elNeedle.style.left = '50%';
  elNeedle.style.background = '#b0a89e';
  elFreq.textContent = '-- Hz';
  elCents.textContent = '';
}

/* ── HTML template ─────────────────────────────────────────── */

function _buildTunerHTML() {
  return `
    <div class="tuner-live">
      <div class="tuner-live-note tuner-no-signal" id="tuner-live-note">--</div>
      <div class="tuner-live-octave" id="tuner-live-octave"></div>
      <div class="tuner-live-meter" id="tuner-live-meter">
        <div class="tuner-live-center"></div>
        <div class="tuner-live-needle" id="tuner-live-needle" style="left:50%"></div>
      </div>
      <div class="tuner-live-labels">
        <span>\u266D flat</span><span>0</span><span>sharp \u266F</span>
      </div>
      <div class="tuner-live-readout">
        <span class="tuner-live-freq" id="tuner-live-freq">-- Hz</span>
        <span class="tuner-live-cents" id="tuner-live-cents"></span>
      </div>
    </div>`;
}
