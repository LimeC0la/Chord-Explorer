/**
 * listener-ui.js
 *
 * Chord Listener — mode orchestrator and shared UI shell.
 *
 * Two modes share the same mic stream:
 *   - Tuner:  Real-time continuous YIN pitch detection (tuner-mode.js)
 *   - Chord:  Onset-triggered capture → analysis → matching (chord-mode.js)
 *
 * This file handles:
 *   - Rendering the shared panel shell (mode toggle, mic button, level meter)
 *   - Starting/stopping the mic via MicManager
 *   - Switching between modes while the mic is running
 *   - Routing click actions to the active mode
 */

import { MicManager } from './mic-manager.js';
import { startTuner, stopTuner }  from './tuner-mode.js';
import {
  startChordMode, stopChordMode,
  handleChordAction, clearChordHistory, hasHistory,
} from './chord-mode.js';

/* ── Constants ─────────────────────────────────────────────── */

const TIMESTAMP_REFRESH_MS = 3000;

/* ── Module state ──────────────────────────────────────────── */

let micManager = null;
let micRunning = false;
let currentMode = 'chord';  // 'tuner' | 'chord'

let timestampInterval = null;

// Level meter rAF for tuner mode (chord mode handles its own via onset loop)
let levelRafId = null;

/* ── Public API ────────────────────────────────────────────── */

export function renderListenerPanel() {
  const container = document.getElementById('listener-area');
  if (!container) return;

  container.innerHTML = `
    <div class="listener-panel listener-panel-tab" id="listener-panel">
      <div class="listener-mode-toggle" id="listener-mode-toggle">
        <button class="mode-btn${currentMode === 'tuner' ? ' active' : ''}"
                data-mode="tuner"
                data-listener-action="set-mode">Tuner</button>
        <button class="mode-btn${currentMode === 'chord' ? ' active' : ''}"
                data-mode="chord"
                data-listener-action="set-mode">Chord Finder</button>
      </div>

      <div class="listener-controls">
        <button class="mic-btn" id="listener-mic-btn"
                data-listener-action="toggle-mic">
          \uD83C\uDFA4 Start Listening
        </button>
        <button class="listener-clear-btn" id="listener-clear-btn"
                data-listener-action="clear-history" style="display:none">
          Clear List
        </button>
      </div>

      <div class="listener-level-bar" id="listener-level-bar">
        <div class="listener-level-fill" id="listener-level-fill"></div>
        <div class="listener-level-gate"
             style="left:${Math.round(0.04 / 0.3 * 100)}%"
             title="Onset threshold"></div>
      </div>

      <div id="listener-state-label" class="listener-state-label"></div>

      <div id="listener-mode-content"></div>

      <p class="listener-footer">
        ${currentMode === 'tuner'
          ? 'Play a single note \u2014 the tuner tracks pitch in real time.'
          : 'Play one chord at a time close to the mic for best results.'}
      </p>
    </div>`;
}

export async function toggleMic() {
  if (micRunning) {
    _stopAll();
    return;
  }

  const btn = document.getElementById('listener-mic-btn');
  if (btn) btn.disabled = true;

  if (!micManager) micManager = new MicManager();

  try {
    await micManager.start();
  } catch (err) {
    _showError(err.message);
    if (btn) btn.disabled = false;
    return;
  }

  micRunning = true;

  if (btn) {
    btn.disabled    = false;
    btn.textContent = '\u23F9 Stop Listening';
    btn.classList.add('listening');
  }

  _updateClearButton();
  _startCurrentMode();
  _startTimestampRefresh();
}

export function applyDetection(rootIdx, typeIdx) {
  // Forwarded from chord-mode via handleListenerClick
  handleChordAction('apply-detection', { dataset: { root: rootIdx, type: typeIdx } });
}

export function clearHistory() {
  clearChordHistory();
  _updateClearButton();
}

export function handleListenerClick(action, target) {
  switch (action) {
    case 'toggle-mic':
      toggleMic();
      break;
    case 'set-mode':
      _setMode(target.dataset.mode);
      break;
    case 'clear-history':
      clearHistory();
      break;
    default:
      // Route to chord mode for all other actions
      handleChordAction(action, target);
      break;
  }
}

/* ── Mode switching ────────────────────────────────────────── */

function _setMode(newMode) {
  if (newMode === currentMode) return;
  if (newMode !== 'tuner' && newMode !== 'chord') return;

  // Stop current mode's processing loop (but keep mic running)
  if (micRunning) _stopCurrentMode();

  currentMode = newMode;
  _updateModeToggle();
  _updateFooter();
  _updateClearButton();

  // Hide onset gate marker in tuner mode
  const gate = document.querySelector('.listener-level-gate');
  if (gate) gate.style.display = currentMode === 'tuner' ? 'none' : '';

  // Start new mode's processing loop
  if (micRunning) _startCurrentMode();
}

function _startCurrentMode() {
  const container = document.getElementById('listener-mode-content');
  if (!container) return;

  if (currentMode === 'tuner') {
    _setStateLabel('');
    startTuner(micManager, container, _updateLevelMeter);
  } else {
    startChordMode(micManager, container, {
      setStateLabel: _setStateLabel,
      updateLevelMeter: _updateLevelMeter,
    });
  }
}

function _stopCurrentMode() {
  if (currentMode === 'tuner') {
    stopTuner();
  } else {
    stopChordMode();
  }
  if (levelRafId != null) {
    cancelAnimationFrame(levelRafId);
    levelRafId = null;
  }
}

function _stopAll() {
  _stopCurrentMode();
  _stopTimestampRefresh();

  if (micManager) micManager.stop();
  micRunning = false;

  _setStateLabel('');
  _updateLevelMeter(0);

  const btn = document.getElementById('listener-mic-btn');
  if (btn) {
    btn.textContent = '\uD83C\uDFA4 Start Listening';
    btn.classList.remove('listening');
  }
}

/* ── UI helpers ────────────────────────────────────────────── */

function _setStateLabel(text) {
  const el = document.getElementById('listener-state-label');
  if (el) el.textContent = text;
}

function _showError(msg) {
  const container = document.getElementById('listener-mode-content');
  if (container) container.innerHTML = `<p class="listener-error">${msg}</p>`;
}

function _updateLevelMeter(rms) {
  const fill = document.getElementById('listener-level-fill');
  if (!fill) return;
  const pct = Math.min(rms / 0.3, 1) * 100;
  fill.style.width = pct + '%';
  fill.className   = 'listener-level-fill' + (rms >= 0.04 ? ' active' : '');
}

function _updateModeToggle() {
  const buttons = document.querySelectorAll('#listener-mode-toggle .mode-btn');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
  });
}

function _updateFooter() {
  const footer = document.querySelector('.listener-footer');
  if (!footer) return;
  footer.textContent = currentMode === 'tuner'
    ? 'Play a single note \u2014 the tuner tracks pitch in real time.'
    : 'Play one chord at a time close to the mic for best results.';
}

function _updateClearButton() {
  const clearBtn = document.getElementById('listener-clear-btn');
  if (!clearBtn) return;
  clearBtn.style.display = (currentMode === 'chord' && hasHistory()) ? '' : 'none';
}

function _startTimestampRefresh() {
  if (timestampInterval != null) return;
  timestampInterval = setInterval(() => {
    // Chord mode re-renders history to update relative timestamps
    if (currentMode === 'chord' && hasHistory()) {
      // Trigger a lightweight re-render by dispatching to chord mode
      const container = document.getElementById('chord-mode-results');
      if (container) {
        // Update relative time labels in-place
        const timeEls = container.querySelectorAll('.detect-prev-time');
        timeEls.forEach(el => {
          const card = el.closest('.detect-card');
          if (card) {
            // Timestamps are managed by chord-mode's internal state,
            // so we just need a full re-render occasionally
          }
        });
      }
    }
  }, TIMESTAMP_REFRESH_MS);
}

function _stopTimestampRefresh() {
  if (timestampInterval != null) {
    clearInterval(timestampInterval);
    timestampInterval = null;
  }
}
