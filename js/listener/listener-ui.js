/**
 * listener-ui.js
 *
 * Chord Listener — state machine controller and UI renderer.
 *
 * State machine:
 *   IDLE → LISTENING → CAPTURING → ANALYSING → DISPLAYING → LISTENING
 *
 * - IDLE:       Mic off. Button says "Start Listening".
 * - LISTENING:  Mic on, onset detector running in rAF loop.
 * - CAPTURING:  Onset detected, AudioCapture recording (adaptive duration).
 * - ANALYSING:  Buffer complete, running PitchAnalyser + ChordMatcher (~100-200ms).
 * - DISPLAYING: Result shown. Monitor for next onset.
 *
 * Extra features (integrated inline):
 *   - Tuning indicator: single-note → cents deviation display
 *   - Try-again hints: diagnostic messages when confidence is low
 *   - Play it back: replay the captured audio snippet
 *   - Manual scrub: canvas waveform with drag-to-select region + re-analyse
 */

import { MicManager }      from './mic-manager.js';
import { OnsetDetector }   from './onset-detector.js';
import { AudioCapture }    from './audio-capture.js';
import { PitchAnalyser }   from './pitch-analyser.js';
import { ChordMatcher }    from './chord-matcher.js';
import { NOTE_NAMES }      from '../music-theory.js';
import { navigateToChord } from '../ui.js';

/* ── Constants ─────────────────────────────────────────────── */

const STATE = Object.freeze({
  IDLE:       'IDLE',
  LISTENING:  'LISTENING',
  CAPTURING:  'CAPTURING',
  ANALYSING:  'ANALYSING',
  DISPLAYING: 'DISPLAYING',
});

const MAX_HISTORY           = 8;
const CANDIDATE_MIN_PCT     = 40;
const TIMESTAMP_REFRESH_MS  = 3000;

/* ── Module-level state ────────────────────────────────────── */

let micManager    = null;
let onsetDetector = null;
let audioCapture  = null;
let pitchAnalyser = null;
let matcher       = null;

let currentState = STATE.IDLE;
let animFrameId  = null;

// Detection history — newest first
let detectionHistory = [];

// Latest raw capture buffer (for playback + scrub)
let latestCaptureBuffer = null;  // { samples: Float32Array, sampleRate: number, durationMs: number }

// Scrub selection state
let scrubSelection = { startMs: 0, endMs: 1200 };
let waveformVisible = false;
let scrubDragging = false;
let scrubDragEdge = null; // 'start' | 'end' | 'region'
let scrubDragStartX = 0;
let scrubDragStartMs = 0;

// Playback
let playbackSource = null;

// Timestamp refresh
let timestampInterval = null;

/* ── Public API ────────────────────────────────────────────── */

export function renderListenerPanel() {
  const container = document.getElementById('listener-area');
  if (!container) return;

  container.innerHTML = `
    <div class="listener-panel listener-panel-tab" id="listener-panel">
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

      <div id="listener-results"></div>

      <p class="listener-footer">
        Works best with a single instrument close to the mic \u2014
        play one chord at a time for best results.
      </p>
    </div>`;
}

export async function toggleMic() {
  if (currentState !== STATE.IDLE) {
    _stopListening();
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

  if (!matcher)       matcher       = new ChordMatcher();
  if (!pitchAnalyser) pitchAnalyser = new PitchAnalyser(micManager.getSampleRate());

  onsetDetector = new OnsetDetector(micManager.getAnalyser());
  audioCapture  = new AudioCapture(micManager);

  if (btn) {
    btn.disabled    = false;
    btn.textContent = '\u23F9 Stop Listening';
    btn.classList.add('listening');
  }

  _setState(STATE.LISTENING);
  _setStateLabel('Listening\u2026');
  _startTimestampRefresh();
  _listenLoop();
}

export function applyDetection(rootIdx, typeIdx) {
  navigateToChord(rootIdx, typeIdx, { switchToTab: true });
}

export function clearHistory() {
  detectionHistory    = [];
  latestCaptureBuffer = null;
  scrubSelection      = { startMs: 0, endMs: 1200 };
  waveformVisible     = false;
  _stopPlayback();
  _renderResults();
  const clearBtn = document.getElementById('listener-clear-btn');
  if (clearBtn) clearBtn.style.display = 'none';
}

export function handleListenerClick(action, target) {
  switch (action) {
    case 'toggle-mic':
      toggleMic();
      break;
    case 'clear-history':
      clearHistory();
      break;
    case 'apply-detection': {
      const r = parseInt(target.dataset.root, 10);
      const t = parseInt(target.dataset.type, 10);
      if (!isNaN(r) && !isNaN(t)) applyDetection(r, t);
      break;
    }
    case 'toggle-waveform':
      waveformVisible = !waveformVisible;
      _renderResults();
      if (waveformVisible && latestCaptureBuffer) {
        requestAnimationFrame(() => _initWaveform());
      }
      break;
    case 'reanalyse-selection':
      _reanalyseSelection();
      break;
    case 'toggle-playback':
      if (playbackSource) {
        _stopPlayback();
      } else {
        _playCapture();
      }
      break;
  }
}

/* ── State machine ─────────────────────────────────────────── */

function _setState(s) { currentState = s; }

function _stopListening() {
  if (animFrameId != null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (audioCapture) audioCapture.cancel();
  if (micManager)   micManager.stop();
  _stopPlayback();
  _stopTimestampRefresh();
  _setState(STATE.IDLE);
  _setStateLabel('');

  const btn = document.getElementById('listener-mic-btn');
  if (btn) {
    btn.textContent = '\uD83C\uDFA4 Start Listening';
    btn.classList.remove('listening');
  }
}

function _listenLoop() {
  if (currentState === STATE.IDLE ||
      currentState === STATE.CAPTURING ||
      currentState === STATE.ANALYSING) return;
  if (!micManager || !micManager.isActive()) return;

  const check = onsetDetector.check();
  _updateLevelMeter(check.rms);

  if (check.onset && currentState === STATE.LISTENING) {
    _beginCapture();
    return;
  }

  animFrameId = requestAnimationFrame(_listenLoop);
}

function _beginCapture() {
  _setState(STATE.CAPTURING);
  _setStateLabel('Capturing\u2026');

  audioCapture = new AudioCapture(micManager);
  audioCapture.startCapture(() => _beginAnalysis());
}

function _beginAnalysis() {
  _setState(STATE.ANALYSING);

  const buf = audioCapture.getBuffer();
  if (!buf) {
    _setState(STATE.LISTENING);
    _setStateLabel('Listening\u2026');
    _listenLoop();
    return;
  }

  // Save buffer for playback + scrub
  latestCaptureBuffer = buf;
  scrubSelection      = { startMs: 0, endMs: buf.durationMs };
  waveformVisible     = false;

  // ── Stage 1: Quick (~50ms) — show a rough result fast ─────
  _setStateLabel('Analysing\u2026');

  setTimeout(() => {
    const quickAnalysis = pitchAnalyser.analyseQuick(buf);
    let quickMatch = null;
    if (quickAnalysis.pitchClasses.size >= 2) {
      quickMatch = matcher.match(quickAnalysis.pitchClasses);
    }
    _addToHistory(quickMatch, quickAnalysis);
    _renderResults();

    // ── Stage 2: Full (~300ms) — refine with multi-resolution ─
    _setStateLabel('Refining\u2026');

    setTimeout(() => {
      const fullAnalysis = pitchAnalyser.analyseFull(buf);
      let fullMatch = null;
      if (fullAnalysis.pitchClasses.size >= 2) {
        fullMatch = matcher.match(fullAnalysis.pitchClasses);
      }
      _updateLatestEntry(fullMatch, fullAnalysis);
      _renderResults();

      // ── Stage 3: Deep (~600ms) — consensus voting, final answer ─
      _setStateLabel('Deep analysis\u2026');

      setTimeout(() => {
        const deepAnalysis = pitchAnalyser.analyseDeep(buf);
        let deepMatch = null;
        if (deepAnalysis.pitchClasses.size >= 2) {
          deepMatch = matcher.match(deepAnalysis.pitchClasses);
        }
        _updateLatestEntry(deepMatch, deepAnalysis);
        _setStateLabel('');
        _renderResults();

        // Resume listening for the next onset
        _setState(STATE.LISTENING);
        _setStateLabel('Listening\u2026');
        animFrameId = requestAnimationFrame(_listenLoop);
      }, 0);
    }, 0);
  }, 0);
}

/* ── History management ────────────────────────────────────── */

function _addToHistory(matchResult, analysis) {
  if (matchResult && matchResult.candidates.length > 0) {
    const entry = {
      timestamp:     Date.now(),
      candidates:    matchResult.candidates,
      detectedNotes: matchResult.detectedNotes,
      dominantNote:  analysis.dominantNote,
      isSingleNote:  analysis.isSingleNote,
    };

    detectionHistory.unshift(entry);
    if (detectionHistory.length > MAX_HISTORY) detectionHistory.pop();

    const clearBtn = document.getElementById('listener-clear-btn');
    if (clearBtn) clearBtn.style.display = '';

    // Update explorer silently (don't switch away from Listener tab)
    navigateToChord(matchResult.candidates[0].rootIdx, matchResult.candidates[0].typeIdx, { switchToTab: false });

  } else if (analysis.isSingleNote && analysis.dominantNote) {
    // Single note — store a tuner-mode entry (no candidates)
    const entry = {
      timestamp:     Date.now(),
      candidates:    [],
      detectedNotes: [...(analysis.pitchClasses?.keys() || [])],
      dominantNote:  analysis.dominantNote,
      isSingleNote:  true,
    };
    detectionHistory.unshift(entry);
    if (detectionHistory.length > MAX_HISTORY) detectionHistory.pop();
    const clearBtn = document.getElementById('listener-clear-btn');
    if (clearBtn) clearBtn.style.display = '';
  }
  // Else: nothing detected — don't add to history
}

/**
 * Update the latest history entry in-place with improved analysis results.
 * Called by Stage 2 and Stage 3 to refine the rough Stage 1 result.
 */
function _updateLatestEntry(matchResult, analysis) {
  if (detectionHistory.length === 0) return;

  if (matchResult && matchResult.candidates.length > 0) {
    detectionHistory[0].candidates    = matchResult.candidates;
    detectionHistory[0].detectedNotes = matchResult.detectedNotes;
    detectionHistory[0].isSingleNote  = analysis.isSingleNote;
    detectionHistory[0].dominantNote  = analysis.dominantNote;

    // Update explorer silently with the refined match
    navigateToChord(matchResult.candidates[0].rootIdx, matchResult.candidates[0].typeIdx, { switchToTab: false });

  } else if (analysis.isSingleNote && analysis.dominantNote) {
    detectionHistory[0].candidates    = [];
    detectionHistory[0].detectedNotes = [...(analysis.pitchClasses?.keys() || [])];
    detectionHistory[0].isSingleNote  = true;
    detectionHistory[0].dominantNote  = analysis.dominantNote;
  }
}

/* ── Rendering ─────────────────────────────────────────────── */

function _renderResults() {
  const container = document.getElementById('listener-results');
  if (!container) return;

  if (detectionHistory.length === 0) {
    container.innerHTML = '';
    return;
  }

  const [latest, ...previous] = detectionHistory;
  const parts = [_renderLatestCard(latest)];

  if (previous.length > 0) {
    parts.push(
      `<div class="detect-prev-section">${previous.map(_renderPrevRow).join('')}</div>`
    );
  }

  container.innerHTML = parts.join('');

  // Re-attach waveform event listeners after innerHTML replacement
  if (waveformVisible && latestCaptureBuffer) {
    requestAnimationFrame(() => _initWaveform());
  }
}

function _renderLatestCard(entry) {
  // ── Tuner mode: single note ───────────────────────────────
  if (entry.isSingleNote && entry.candidates.length === 0 && entry.dominantNote) {
    return _renderTunerCard(entry.dominantNote);
  }

  // ── No chord match ────────────────────────────────────────
  if (entry.candidates.length === 0) {
    const hint = _getDiagnosticHint(null, 0, new Map());
    return `
      <div class="detect-card detect-latest">
        <div class="detect-label">Latest</div>
        <p class="listener-hint">No chord detected \u2014 try playing closer to the mic</p>
        ${hint ? _renderHint(hint) : ''}
      </div>`;
  }

  // ── Chord detection result ────────────────────────────────
  const top    = entry.candidates[0];
  const others = entry.candidates.slice(1).filter(c => c.confidence >= CANDIDATE_MIN_PCT);

  const candidatesHtml = [
    _renderCandidateRow(top, true),
    ...others.map(c => _renderCandidateRow(c, false)),
  ].join('');

  const noteNames = entry.detectedNotes.map(pc => NOTE_NAMES[pc]).join(' ');

  const hint = _getDiagnosticHint(
    { candidates: entry.candidates },
    0, // rmsLevel not stored in history (already passed gate)
    new Map(entry.detectedNotes.map(pc => [pc, { hits: 1, avgConfidence: 0.9 }]))
  );

  const waveformToggleText = waveformVisible ? 'Hide waveform' : 'Show waveform';
  const waveformHtml = waveformVisible ? _renderWaveformWidget() : '';

  return `
    <div class="detect-card detect-latest">
      <div class="detect-label">Latest</div>
      <div class="detect-candidates">
        ${candidatesHtml}
      </div>
      <div class="detect-notes">Notes heard: ${noteNames}</div>
      ${waveformHtml}
      ${hint ? _renderHint(hint) : ''}
      <div class="detect-actions">
        <button class="detect-apply"
                data-listener-action="apply-detection"
                data-root="${top.rootIdx}"
                data-type="${top.typeIdx}">
          Apply ${top.symbol}
        </button>
        ${latestCaptureBuffer
          ? `<button class="detect-playback-btn" id="detect-playback-btn"
                     data-listener-action="toggle-playback">
               \u25B6 Play back
             </button>`
          : ''}
        <button class="detect-waveform-toggle"
                data-listener-action="toggle-waveform">
          ${waveformToggleText}
        </button>
      </div>
    </div>`;
}

function _renderCandidateRow(candidate, isPrimary) {
  const cls = isPrimary ? 'detect-candidate primary' : 'detect-candidate secondary';
  return `
    <div class="${cls}">
      <span class="detect-chord-name">${candidate.symbol}</span>
      <div class="detect-conf-bar">
        <div class="detect-conf-fill" style="width:${candidate.confidence}%"></div>
      </div>
      <span class="detect-conf-pct">${candidate.confidence}%</span>
    </div>`;
}

function _renderPrevRow(entry) {
  const age   = _relativeTime(entry.timestamp);
  const faded = _isOld(entry.timestamp) ? ' detect-faded' : '';

  // ── Tuner entry (single note, no chord candidates) ────────
  if ((!entry.candidates || entry.candidates.length === 0) && entry.isSingleNote && entry.dominantNote) {
    const n = entry.dominantNote;
    const clamped    = Math.max(-50, Math.min(50, n.cents));
    const pct        = ((clamped + 50) / 100) * 100;
    const absCents   = Math.abs(clamped);
    let needleColor;
    if (absCents <= 5)       needleColor = '#4a9060';
    else if (absCents <= 15) needleColor = '#d0a030';
    else                     needleColor = '#d0585a';
    const readout = n.cents === 0
      ? 'In tune'
      : `${n.cents > 0 ? '+' : ''}${n.cents}\u00A2`;

    return `
      <div class="detect-card detect-history${faded}">
        <div class="detect-history-header">
          <span class="detect-label">Single Note</span>
          <span class="detect-prev-time">${age}</span>
        </div>
        <div class="detect-tuner detect-tuner-compact">
          <span class="detect-tuner-note-sm">${n.noteName}<sub>${n.octave}</sub></span>
          <div class="detect-tuner-meter" style="max-width:140px;display:inline-block;flex:1">
            <div class="detect-tuner-center"></div>
            <div class="detect-tuner-needle" style="left:${pct}%;background:${needleColor}"></div>
          </div>
          <span class="detect-tuner-readout-sm">${readout}</span>
        </div>
      </div>`;
  }

  if (!entry.candidates || entry.candidates.length === 0) return '';

  // ── Chord entry (expanded with confidence bars) ───────────
  const top    = entry.candidates[0];
  const others = entry.candidates.slice(1).filter(c => c.confidence >= CANDIDATE_MIN_PCT);

  const candidatesHtml = [
    _renderCandidateRow(top, true),
    ...others.map(c => _renderCandidateRow(c, false)),
  ].join('');

  const noteNames = (entry.detectedNotes || []).map(pc => NOTE_NAMES[pc]).join(' ');

  return `
    <div class="detect-card detect-history${faded}">
      <div class="detect-history-header">
        <span class="detect-label">Detection</span>
        <span class="detect-prev-time">${age}</span>
      </div>
      <div class="detect-candidates">
        ${candidatesHtml}
      </div>
      <div class="detect-notes">Notes heard: ${noteNames}</div>
      <button class="detect-apply detect-apply-sm"
              data-listener-action="apply-detection"
              data-root="${top.rootIdx}"
              data-type="${top.typeIdx}">
        Apply ${top.symbol}
      </button>
    </div>`;
}

/* ── Feature: Tuning indicator ─────────────────────────────── */

function _renderTunerCard(note) {
  const { noteName, octave, cents } = note;
  const clamped = Math.max(-50, Math.min(50, cents));
  const pct     = ((clamped + 50) / 100) * 100; // 0%=-50¢, 50%=0¢, 100%=+50¢

  let needleColor;
  const absCents = Math.abs(clamped);
  if (absCents <= 5)       needleColor = '#4a9060';
  else if (absCents <= 15) needleColor = '#d0a030';
  else                     needleColor = '#d0585a';

  const readout = cents === 0
    ? 'In tune'
    : `${cents > 0 ? '+' : ''}${cents}\u00A2 \u2014 ${Math.abs(cents) <= 5 ? 'in tune' : cents > 0 ? 'slightly sharp' : 'slightly flat'}`;

  const waveformToggleText = waveformVisible ? 'Hide waveform' : 'Show waveform';
  const waveformHtml = waveformVisible ? _renderWaveformWidget() : '';

  return `
    <div class="detect-card detect-latest">
      <div class="detect-label">Single Note</div>
      <div class="detect-tuner">
        <div class="detect-tuner-note">${noteName}<sub style="font-size:0.5em">${octave}</sub></div>
        <div class="detect-tuner-meter">
          <div class="detect-tuner-center"></div>
          <div class="detect-tuner-needle"
               style="left:${pct}%; background:${needleColor}"></div>
        </div>
        <div class="detect-tuner-labels">
          <span>\u266D -25\u00A2</span><span>0</span><span>+25\u00A2 \u266F</span>
        </div>
        <div class="detect-tuner-readout">${readout}</div>
      </div>
      ${waveformHtml}
      <div class="detect-actions">
        ${latestCaptureBuffer
          ? `<button class="detect-playback-btn" id="detect-playback-btn"
                     data-listener-action="toggle-playback">
               \u25B6 Play back
             </button>`
          : ''}
        <button class="detect-waveform-toggle"
                data-listener-action="toggle-waveform">
          ${waveformToggleText}
        </button>
      </div>
    </div>`;
}

/* ── Feature: Try-again hints ──────────────────────────────── */

function _getDiagnosticHint(matchResult, rmsLevel, detectedNotes) {
  const candidateCount  = detectedNotes.size;
  const bestConfidence  = matchResult?.candidates?.[0]?.confidence || 0;

  if (rmsLevel > 0 && rmsLevel < 0.02) {
    return { icon: '\uD83D\uDD07', text: 'Very quiet \u2014 try strumming harder or moving closer to the mic' };
  }
  if (candidateCount < 2 && matchResult !== null) {
    return { icon: '\uD83C\uDFB5', text: 'Only one note came through clearly \u2014 try strumming all the strings' };
  }
  if (candidateCount > 6) {
    return { icon: '\uD83D\uDD0A', text: 'Lots of frequencies detected \u2014 try a quieter room or get closer to the mic' };
  }
  if (candidateCount >= 2 && candidateCount <= 6 && bestConfidence < 40) {
    return { icon: '\uD83E\uDD14', text: "Those notes don\u2019t match a standard chord \u2014 check your finger placement?" };
  }
  if (bestConfidence >= 40 && bestConfidence < 55) {
    return { icon: '\uD83C\uDFAF', text: 'Close but not clear \u2014 let the chord ring a bit longer after strumming' };
  }
  if (matchResult?.candidates?.length >= 2) {
    const gap = matchResult.candidates[0].confidence - matchResult.candidates[1].confidence;
    if (gap < 10) {
      return { icon: '\u2696\uFE0F', text: 'Could be either chord \u2014 the 3rd might be muted. Try strumming more evenly.' };
    }
  }
  return null;
}

function _renderHint(hint) {
  return `
    <div class="detect-hint">
      <span class="detect-hint-icon">${hint.icon}</span>
      <span class="detect-hint-text">${hint.text}</span>
    </div>`;
}

/* ── Feature: Play it back ─────────────────────────────────── */

function _playCapture() {
  if (!latestCaptureBuffer) return;
  _stopPlayback();

  const { samples, sampleRate } = latestCaptureBuffer;
  const startSample = Math.floor((scrubSelection.startMs / 1000) * sampleRate);
  const endSample   = Math.floor((scrubSelection.endMs   / 1000) * sampleRate);
  const region      = samples.slice(startSample, endSample);

  // Use Tone.js AudioContext so we don't open a third AudioContext on mobile
  let ctx;
  try {
    ctx = window.Tone ? Tone.context : new AudioContext();
  } catch (_) {
    return;
  }

  const audioBuf = ctx.createBuffer(1, region.length, sampleRate);
  audioBuf.copyToChannel(region, 0);

  playbackSource = ctx.createBufferSource();
  playbackSource.buffer = audioBuf;
  playbackSource.connect(ctx.destination);
  playbackSource.start();

  playbackSource.onended = () => {
    playbackSource = null;
    _updatePlaybackButton(false);
  };

  _updatePlaybackButton(true);
}

function _stopPlayback() {
  if (playbackSource) {
    try { playbackSource.stop(); } catch (_) { /* already ended */ }
    playbackSource = null;
  }
  _updatePlaybackButton(false);
}

function _updatePlaybackButton(isPlaying) {
  const btn = document.getElementById('detect-playback-btn');
  if (!btn) return;
  btn.textContent = isPlaying ? '\u23F9 Stop' : '\u25B6 Play back';
  btn.classList.toggle('playing', isPlaying);
}

/* ── Feature: Manual scrub ─────────────────────────────────── */

function _renderWaveformWidget() {
  return `
    <div class="detect-waveform-wrap" id="detect-waveform-wrap">
      <canvas class="detect-waveform-canvas" id="detect-waveform-canvas"
              height="60"></canvas>
      <div class="detect-waveform-time-axis" id="detect-waveform-time-axis">
        <span>0.0s</span><span>...</span><span>...</span><span>...</span><span>...</span>
      </div>
      <button class="detect-reanalyse-btn" id="detect-reanalyse-btn"
              data-listener-action="reanalyse-selection">
        Re-analyse selection
      </button>
    </div>`;
}

function _initWaveform() {
  const canvas = document.getElementById('detect-waveform-canvas');
  if (!canvas || !latestCaptureBuffer) return;

  // Set canvas width to match CSS layout width
  canvas.width = canvas.offsetWidth || 300;

  // Update time axis labels based on actual capture duration
  const timeAxis = document.getElementById('detect-waveform-time-axis');
  if (timeAxis) {
    const dur = latestCaptureBuffer.durationMs / 1000;
    const spans = timeAxis.querySelectorAll('span');
    if (spans.length >= 5) {
      for (let i = 0; i < 5; i++) {
        spans[i].textContent = (dur * i / 4).toFixed(1) + 's';
      }
    }
  }

  _drawWaveform(canvas);
  _attachScrubListeners(canvas);
}

function _drawWaveform(canvas) {
  if (!latestCaptureBuffer) return;
  const { samples, sampleRate, durationMs } = latestCaptureBuffer;

  const ctx = canvas.getContext('2d');
  const w   = canvas.width;
  const h   = canvas.height;

  // Background
  const isDark = document.documentElement.classList.contains('dark') ||
                 document.body.classList.contains('dark');
  ctx.fillStyle = isDark ? '#1e1c24' : '#f0ece6';
  ctx.fillRect(0, 0, w, h);

  // Downsample to canvas width
  const blockSize = Math.floor(samples.length / w);
  const points = [];
  for (let i = 0; i < w; i++) {
    let sum = 0;
    const start = i * blockSize;
    for (let j = start; j < start + blockSize && j < samples.length; j++) {
      sum += Math.abs(samples[j]);
    }
    points.push(blockSize > 0 ? sum / blockSize : 0);
  }
  const maxVal = Math.max(...points, 0.01);

  // Draw waveform bars (mirrored around centre)
  ctx.fillStyle = isDark ? '#3a3050' : '#c5b8d8';
  for (let i = 0; i < w; i++) {
    const barH = (points[i] / maxVal) * (h * 0.8);
    ctx.fillRect(i, (h - barH) / 2, 1, barH);
  }

  // Selection overlay
  const totalMs    = durationMs;
  const selStartX  = (scrubSelection.startMs / totalMs) * w;
  const selEndX    = (scrubSelection.endMs   / totalMs) * w;

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, selStartX, h);
  ctx.fillRect(selEndX, 0, w - selEndX, h);

  // Selection border lines
  ctx.strokeStyle = '#6a50a0';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(selStartX, 0); ctx.lineTo(selStartX, h);
  ctx.moveTo(selEndX,   0); ctx.lineTo(selEndX,   h);
  ctx.stroke();

  // Drag handles (larger touch targets)
  ctx.fillStyle = '#6a50a0';
  ctx.fillRect(selStartX - 6, 0, 12, h);
  ctx.fillRect(selEndX   - 6, 0, 12, h);
}

function _attachScrubListeners(canvas) {
  // Clean up previous listeners by replacing with a fresh clone
  const fresh = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(fresh, canvas);

  const MIN_SELECTION_MS = 200;

  function getMs(clientX) {
    const rect  = fresh.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * (latestCaptureBuffer?.durationMs || 1200);
  }

  function getEdge(clientX) {
    const rect     = fresh.getBoundingClientRect();
    const totalMs  = latestCaptureBuffer?.durationMs || 1200;
    const startPx  = (scrubSelection.startMs / totalMs) * rect.width;
    const endPx    = (scrubSelection.endMs   / totalMs) * rect.width;
    const x        = clientX - rect.left;
    const HANDLE   = 14;
    if (Math.abs(x - startPx) < HANDLE) return 'start';
    if (Math.abs(x - endPx)   < HANDLE) return 'end';
    return 'region';
  }

  function onDown(clientX) {
    scrubDragging   = true;
    scrubDragEdge   = getEdge(clientX);
    scrubDragStartX = clientX;
    scrubDragStartMs = scrubDragEdge === 'start' ? scrubSelection.startMs
                     : scrubDragEdge === 'end'   ? scrubSelection.endMs
                     : getMs(clientX);
  }

  function onMove(clientX) {
    if (!scrubDragging) return;
    const totalMs = latestCaptureBuffer?.durationMs || 1200;
    const rect    = fresh.getBoundingClientRect();
    const dMs     = ((clientX - scrubDragStartX) / rect.width) * totalMs;

    if (scrubDragEdge === 'start') {
      const newStart = Math.max(0, Math.min(scrubSelection.endMs - MIN_SELECTION_MS,
                                            scrubDragStartMs + dMs));
      scrubSelection.startMs = newStart;
    } else if (scrubDragEdge === 'end') {
      const newEnd = Math.min(totalMs, Math.max(scrubSelection.startMs + MIN_SELECTION_MS,
                                                scrubDragStartMs + dMs));
      scrubSelection.endMs = newEnd;
    } else {
      // New selection by dragging in region
      const clickMs = scrubDragStartMs;
      const nowMs   = getMs(clientX);
      scrubSelection.startMs = Math.max(0,       Math.min(clickMs, nowMs));
      scrubSelection.endMs   = Math.min(totalMs, Math.max(clickMs, nowMs));
      if (scrubSelection.endMs - scrubSelection.startMs < MIN_SELECTION_MS) {
        scrubSelection.endMs = Math.min(totalMs, scrubSelection.startMs + MIN_SELECTION_MS);
      }
    }

    _drawWaveform(fresh);
    _showReanalyseBtn();
  }

  function onUp() {
    scrubDragging = false;
    scrubDragEdge = null;
  }

  // Mouse
  fresh.addEventListener('mousedown',  e => { onDown(e.clientX); });
  window.addEventListener('mousemove', e => { if (scrubDragging) onMove(e.clientX); });
  window.addEventListener('mouseup',   () => onUp());

  // Touch
  fresh.addEventListener('touchstart', e => {
    e.preventDefault();
    onDown(e.touches[0].clientX);
  }, { passive: false });
  fresh.addEventListener('touchmove', e => {
    e.preventDefault();
    onMove(e.touches[0].clientX);
  }, { passive: false });
  fresh.addEventListener('touchend', () => onUp());

  _drawWaveform(fresh);
}

function _showReanalyseBtn() {
  const btn = document.getElementById('detect-reanalyse-btn');
  if (btn) btn.classList.add('visible');
}

function _reanalyseSelection() {
  if (!latestCaptureBuffer || !pitchAnalyser || !matcher) return;

  _setStateLabel('Re-analysing\u2026');

  setTimeout(() => {
    const { samples, sampleRate } = latestCaptureBuffer;
    const startSample = Math.floor((scrubSelection.startMs / 1000) * sampleRate);
    const endSample   = Math.floor((scrubSelection.endMs   / 1000) * sampleRate);

    const subBuffer = {
      samples:    samples.slice(startSample, endSample),
      sampleRate,
      durationMs: scrubSelection.endMs - scrubSelection.startMs,
    };

    // Run the full deep analysis on the selected region
    const analysis  = pitchAnalyser.analyseDeep(subBuffer);
    let matchResult = null;
    if (analysis.pitchClasses.size >= 2) {
      matchResult = matcher.match(analysis.pitchClasses);
    }

    _updateLatestEntry(matchResult, analysis);
    _setStateLabel('');
    _renderResults();
  }, 0);
}

/* ── UI helpers ────────────────────────────────────────────── */

function _setStateLabel(text) {
  const el = document.getElementById('listener-state-label');
  if (el) el.textContent = text;
}

function _showError(msg) {
  const el = document.getElementById('listener-results');
  if (el) el.innerHTML = `<p class="listener-error">${msg}</p>`;
}

function _updateLevelMeter(rms) {
  const fill = document.getElementById('listener-level-fill');
  if (!fill) return;
  const pct = Math.min(rms / 0.3, 1) * 100;
  fill.style.width = pct + '%';
  fill.className   = 'listener-level-fill' + (rms >= 0.04 ? ' active' : '');
}

function _relativeTime(timestamp) {
  const sec = Math.round((Date.now() - timestamp) / 1000);
  if (sec < 5)  return 'just now';
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

function _isOld(timestamp) {
  return (Date.now() - timestamp) > 30000;
}

function _startTimestampRefresh() {
  if (timestampInterval != null) return;
  timestampInterval = setInterval(() => {
    if (detectionHistory.length > 0) _renderResults();
  }, TIMESTAMP_REFRESH_MS);
}

function _stopTimestampRefresh() {
  if (timestampInterval != null) {
    clearInterval(timestampInterval);
    timestampInterval = null;
  }
}
