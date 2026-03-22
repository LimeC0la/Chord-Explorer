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

// Chord history log — newest first, capped at MAX_HISTORY
let chordHistory = [];
const MAX_HISTORY = 30;
let lastLoggedChord = null;  // Key string for dedup ("0-0" = C maj)
let stableMatchStart = 0;   // When the current match first appeared
const STABLE_MS = 400;      // Must be stable this long to log

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
        <div class="listener-controls">
          <button class="mic-btn" id="listener-mic-btn" data-listener-action="toggle-mic">
            \uD83C\uDFA4 Start Listening
          </button>
          <button class="listener-clear-btn" id="listener-clear-btn"
                  data-listener-action="clear-history" style="display:none;">
            Clear
          </button>
        </div>

        <div class="listener-level-bar" id="listener-level-bar">
          <div class="listener-level-fill" id="listener-level-fill"></div>
          <div class="listener-level-gate" style="left:${Math.round(AMP_GATE * 100 / 0.3)}%"
               title="Minimum level to detect"></div>
        </div>

        <div id="listener-current" class="listener-current">
          <p class="listener-hint" id="listener-status">Play a chord and I'll try to identify it</p>
        </div>

        <div class="listener-history-container" id="listener-history-container" style="display:none;">
          <div class="listener-history-label">Detected chords</div>
          <div class="listener-history" id="listener-history"></div>
        </div>

        <p class="listener-footer">Strum or play a chord \u2014 sustained matches are logged below</p>
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
    lastLoggedChord = null;
    stableMatchStart = 0;
    const status = document.getElementById('listener-status');
    if (status) status.textContent = 'Stopped \u2014 history preserved';
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

  const status = document.getElementById('listener-status');
  if (status) status.textContent = 'Listening\u2026';
  lastLoggedChord = null;
  stableMatchStart = 0;

  listenLoop();
}

/**
 * Navigate to a chord from the history list.
 */
export function applyHistoryChord(rootIdx, typeIdx) {
  navigateToChord(rootIdx, typeIdx);
}

/**
 * Clear the chord history log.
 */
export function clearHistory() {
  chordHistory = [];
  lastLoggedChord = null;
  stableMatchStart = 0;
  renderHistory();
  const container = document.getElementById('listener-history-container');
  if (container) container.style.display = 'none';
  const clearBtn = document.getElementById('listener-clear-btn');
  if (clearBtn) clearBtn.style.display = 'none';
}

/**
 * Route a click action from the panel's data-action attributes.
 * @param {string} action
 * @param {HTMLElement} [target] - The clicked element (for data attributes)
 */
export function handleListenerClick(action, target) {
  switch (action) {
    case 'toggle-listener-panel':
      toggleListenerPanel();
      break;
    case 'toggle-mic':
      toggleMic();
      break;
    case 'clear-history':
      clearHistory();
      break;
    case 'history-chord': {
      const r = parseInt(target.dataset.root, 10);
      const t = parseInt(target.dataset.type, 10);
      if (!isNaN(r) && !isNaN(t)) applyHistoryChord(r, t);
      break;
    }
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
 * Update the live status display and log sustained chords to history.
 * A chord must be stable for STABLE_MS before it's logged — prevents
 * transient misidentifications from cluttering the list.
 */
function updateDisplay(match, activeNotes) {
  const status = document.getElementById('listener-status');
  if (!status) return;

  if (!match) {
    currentMatch = null;
    stableMatchStart = 0;
    status.textContent = 'Listening\u2026';
    status.className = 'listener-hint';
    return;
  }

  currentMatch = match;
  const chordKey = match.rootIdx + '-' + match.typeIdx;
  const now = performance.now();
  const symbol = chordSymbol(match.rootIdx, match.typeIdx);
  const pct = Math.round(match.score / (match.score + 2) * 100); // rough %

  // Show current detection in the status line
  const heardNames = [...activeNotes].sort((a, b) => a - b)
    .map(pc => NOTE_NAMES[pc]);
  status.innerHTML = `<span class="listener-live-chord">${symbol}</span> ` +
    `<span class="listener-live-pct">${pct}%</span> ` +
    `<span class="listener-live-heard">${heardNames.join(' ')}</span>`;
  status.className = 'listener-status-active';

  // Track stability — only log after STABLE_MS of the same chord
  if (chordKey !== lastLoggedChord) {
    // Different chord detected — start stability timer
    if (chordKey !== (currentMatch._prevKey || null)) {
      stableMatchStart = now;
      currentMatch._prevKey = chordKey;
    } else if (now - stableMatchStart >= STABLE_MS) {
      // Stable long enough — log it
      logChord(match, pct);
      lastLoggedChord = chordKey;
      currentMatch._prevKey = null;
    }
  }
}

/**
 * Add a chord to the history log and render it.
 */
function logChord(match, pct) {
  const entry = {
    rootIdx: match.rootIdx,
    typeIdx: match.typeIdx,
    symbol: chordSymbol(match.rootIdx, match.typeIdx),
    notes: chordNoteNames(match.rootIdx, match.typeIdx).join(' \u2013 '),
    confidence: match.confidence,
    pct: pct,
    time: new Date(),
  };

  chordHistory.unshift(entry);
  if (chordHistory.length > MAX_HISTORY) chordHistory.pop();

  // Auto-navigate the explorer to this chord
  navigateToChord(match.rootIdx, match.typeIdx);

  // Show the history container + clear button
  const container = document.getElementById('listener-history-container');
  if (container) container.style.display = '';
  const clearBtn = document.getElementById('listener-clear-btn');
  if (clearBtn) clearBtn.style.display = '';

  renderHistory();
}

/**
 * Render the chord history list.
 */
function renderHistory() {
  const list = document.getElementById('listener-history');
  if (!list) return;

  if (chordHistory.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = chordHistory.map((entry, i) => {
    const timeStr = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const stars = confidenceStars(entry.confidence);
    const isNewest = i === 0;
    return `
      <div class="listener-history-row${isNewest ? ' newest' : ''}"
           data-listener-action="history-chord"
           data-root="${entry.rootIdx}"
           data-type="${entry.typeIdx}">
        <span class="lh-chord">${entry.symbol}</span>
        <span class="lh-pct">${entry.pct}%</span>
        <span class="lh-stars">${stars}</span>
        <span class="lh-notes">${entry.notes}</span>
        <span class="lh-time">${timeStr}</span>
      </div>`;
  }).join('');
}
