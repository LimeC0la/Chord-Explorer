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
let analyserBuffer = null;   // Float32Array, reused
let currentMatch = null;     // Last displayed match
let panelExpanded = false;   // Collapse state

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

  analyserBuffer = new Float32Array(micManager.getAnalyser().fftSize);
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
 * requestAnimationFrame-driven detection loop.
 */
function listenLoop() {
  if (!micManager || !micManager.isActive()) return;

  const analyser = micManager.getAnalyser();
  analyser.getFloatTimeDomainData(analyserBuffer);

  const detection = yin(analyserBuffer, micManager.getSampleRate());
  if (detection && detection.confidence > 0.85) {
    // Convert frequency to MIDI note number
    const midi = Math.round(12 * Math.log2(detection.frequency / 440) + 69);
    if (midi >= 24 && midi <= 96) { // Reasonable musical range
      accumulator.addDetection(midi, detection.confidence, performance.now());
    }
  }

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
