/**
 * chord-mode.js
 *
 * Onset-triggered chord detection pipeline.
 *
 * State machine:
 *   LISTENING → CAPTURING → ANALYSING → DISPLAYING → LISTENING
 *
 * Onset detection via RMS threshold → adaptive PCM capture →
 * 3-stage progressive analysis (Quick → Full → Deep) →
 * chord matching → history cards with confidence bars.
 *
 * Extracted from the original listener-ui.js to allow the Listener tab
 * to switch between a real-time Tuner mode and this Chord Finder mode.
 */

import { OnsetDetector } from './onset-detector.js';
import { AudioCapture }  from './audio-capture.js';
import { PitchAnalyser } from './pitch-analyser.js';
import { ChordMatcher }  from './chord-matcher.js';
import { NOTE_NAMES }    from '../music-theory.js';
import { navigateToChord } from '../ui.js';

/* ── Constants ─────────────────────────────────────────────── */

const MAX_HISTORY       = 8;
const CANDIDATE_MIN_PCT = 40;

/* ── Module state ──────────────────────────────────────────── */

let micManager    = null;
let onsetDetector = null;
let audioCapture  = null;
let pitchAnalyser = null;
let matcher       = null;

let animFrameId  = null;
let running      = false;

// Detection history — newest first
let detectionHistory = [];

// Latest raw capture buffer (for playback + scrub)
let latestCaptureBuffer = null;

// Scrub selection state
let scrubSelection  = { startMs: 0, endMs: 0 };
let waveformVisible = false;
let scrubDragging   = false;
let scrubDragEdge   = null;
let scrubDragStartX = 0;
let scrubDragStartMs = 0;

// Playback
let playbackSource = null;

// Callbacks supplied by orchestrator
let setStateLabel = () => {};
let updateLevelMeter = () => {};

/* ── Public API ────────────────────────────────────────────── */

/**
 * Start the chord detection loop.
 *
 * @param {MicManager} mic — must already be started
 * @param {HTMLElement} container — DOM element to render into
 * @param {{ setStateLabel: function, updateLevelMeter: function }} callbacks
 */
export function startChordMode(mic, container, callbacks) {
  if (running) return;

  micManager       = mic;
  setStateLabel    = callbacks.setStateLabel    || (() => {});
  updateLevelMeter = callbacks.updateLevelMeter || (() => {});

  if (!matcher)       matcher       = new ChordMatcher();
  if (!pitchAnalyser) pitchAnalyser = new PitchAnalyser(micManager.getSampleRate());

  onsetDetector = new OnsetDetector(micManager.getAnalyser());
  audioCapture  = new AudioCapture(micManager);

  // Render existing history or empty container
  container.innerHTML = '<div id="chord-mode-results"></div>';
  _renderResults();

  running = true;
  setStateLabel('Listening\u2026');
  _listenLoop();
}

/**
 * Stop the chord detection loop and clean up.
 */
export function stopChordMode() {
  running = false;
  if (animFrameId != null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (audioCapture) audioCapture.cancel();
  _stopPlayback();
}

/** @returns {boolean} */
export function isChordModeRunning() {
  return running;
}

/**
 * Handle click actions routed from the orchestrator.
 */
export function handleChordAction(action, target) {
  switch (action) {
    case 'apply-detection': {
      const r = parseInt(target.dataset.root, 10);
      const t = parseInt(target.dataset.type, 10);
      if (!isNaN(r) && !isNaN(t)) navigateToChord(r, t, { switchToTab: true });
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

/**
 * Clear the detection history.
 */
export function clearChordHistory() {
  detectionHistory    = [];
  latestCaptureBuffer = null;
  scrubSelection      = { startMs: 0, endMs: 0 };
  waveformVisible     = false;
  _stopPlayback();
  _renderResults();
}

/** @returns {boolean} Whether there is any history to show. */
export function hasHistory() {
  return detectionHistory.length > 0;
}

/* ── Listen loop ───────────────────────────────────────────── */

function _listenLoop() {
  if (!running) return;

  const check = onsetDetector.check();
  updateLevelMeter(check.rms);

  if (check.onset) {
    _beginCapture();
    return;
  }

  animFrameId = requestAnimationFrame(_listenLoop);
}

function _beginCapture() {
  setStateLabel('Capturing\u2026');

  audioCapture = new AudioCapture(micManager);
  audioCapture.startCapture(() => _beginAnalysis());
}

function _beginAnalysis() {
  const buf = audioCapture.getBuffer();
  if (!buf) {
    setStateLabel('Listening\u2026');
    animFrameId = requestAnimationFrame(_listenLoop);
    return;
  }

  latestCaptureBuffer = buf;
  scrubSelection      = { startMs: 0, endMs: buf.durationMs };
  waveformVisible     = false;

  // ── Stage 1: Quick ──────────────────────────────────────────
  setStateLabel('Analysing\u2026');

  setTimeout(() => {
    const quickAnalysis = pitchAnalyser.analyseQuick(buf);
    let quickMatch = null;
    if (quickAnalysis.pitchClasses.size >= 2) {
      quickMatch = matcher.match(quickAnalysis.pitchClasses);
    }
    _addToHistory(quickMatch, quickAnalysis);
    _renderResults();

    // ── Stage 2: Full ───────────────────────────────────────────
    setStateLabel('Refining\u2026');

    setTimeout(() => {
      const fullAnalysis = pitchAnalyser.analyseFull(buf);
      let fullMatch = null;
      if (fullAnalysis.pitchClasses.size >= 2) {
        fullMatch = matcher.match(fullAnalysis.pitchClasses);
      }
      _updateLatestEntry(fullMatch, fullAnalysis);
      _renderResults();

      // ── Stage 3: Deep ──────────────────────────────────────────
      setStateLabel('Deep analysis\u2026');

      setTimeout(() => {
        const deepAnalysis = pitchAnalyser.analyseDeep(buf);
        let deepMatch = null;
        if (deepAnalysis.pitchClasses.size >= 2) {
          deepMatch = matcher.match(deepAnalysis.pitchClasses);
        }
        _updateLatestEntry(deepMatch, deepAnalysis);
        _renderResults();

        // Resume listening
        setStateLabel('Listening\u2026');
        animFrameId = requestAnimationFrame(_listenLoop);
      }, 0);
    }, 0);
  }, 0);
}

/* ── History management ────────────────────────────────────── */

function _addToHistory(matchResult, analysis) {
  if (matchResult && matchResult.candidates.length > 0) {
    detectionHistory.unshift({
      timestamp:     Date.now(),
      candidates:    matchResult.candidates,
      detectedNotes: matchResult.detectedNotes,
      dominantNote:  analysis.dominantNote,
      isSingleNote:  analysis.isSingleNote,
    });
    if (detectionHistory.length > MAX_HISTORY) detectionHistory.pop();

    navigateToChord(
      matchResult.candidates[0].rootIdx,
      matchResult.candidates[0].typeIdx,
      { switchToTab: false }
    );

  } else if (analysis.isSingleNote && analysis.dominantNote) {
    detectionHistory.unshift({
      timestamp:     Date.now(),
      candidates:    [],
      detectedNotes: [...(analysis.pitchClasses?.keys() || [])],
      dominantNote:  analysis.dominantNote,
      isSingleNote:  true,
    });
    if (detectionHistory.length > MAX_HISTORY) detectionHistory.pop();
  }
}

function _updateLatestEntry(matchResult, analysis) {
  if (detectionHistory.length === 0) return;

  if (matchResult && matchResult.candidates.length > 0) {
    detectionHistory[0].candidates    = matchResult.candidates;
    detectionHistory[0].detectedNotes = matchResult.detectedNotes;
    detectionHistory[0].isSingleNote  = analysis.isSingleNote;
    detectionHistory[0].dominantNote  = analysis.dominantNote;

    navigateToChord(
      matchResult.candidates[0].rootIdx,
      matchResult.candidates[0].typeIdx,
      { switchToTab: false }
    );

  } else if (analysis.isSingleNote && analysis.dominantNote) {
    detectionHistory[0].candidates    = [];
    detectionHistory[0].detectedNotes = [...(analysis.pitchClasses?.keys() || [])];
    detectionHistory[0].isSingleNote  = true;
    detectionHistory[0].dominantNote  = analysis.dominantNote;
  }
}

/* ── Rendering ─────────────────────────────────────────────── */

function _renderResults() {
  const container = document.getElementById('chord-mode-results');
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

  if (waveformVisible && latestCaptureBuffer) {
    requestAnimationFrame(() => _initWaveform());
  }
}

function _renderLatestCard(entry) {
  // ── Single note — suggest switching to Tuner mode ───────────
  if (entry.isSingleNote && entry.candidates.length === 0 && entry.dominantNote) {
    const n = entry.dominantNote;
    return `
      <div class="detect-card detect-latest">
        <div class="detect-label">Single Note</div>
        <p class="detect-single-note-msg">
          Detected <strong>${n.noteName}${n.octave}</strong> \u2014
          try strumming a full chord, or switch to <strong>Tuner</strong> mode
          for pitch tracking.
        </p>
        <div class="detect-actions">
          ${_playbackButton()}
          ${_waveformToggleButton()}
        </div>
      </div>`;
  }

  // ── No chord match ──────────────────────────────────────────
  if (entry.candidates.length === 0) {
    const hint = _getDiagnosticHint(null, 0, new Map());
    return `
      <div class="detect-card detect-latest">
        <div class="detect-label">Latest</div>
        <p class="listener-hint">No chord detected \u2014 try playing closer to the mic</p>
        ${hint ? _renderHint(hint) : ''}
      </div>`;
  }

  // ── Chord detection result ──────────────────────────────────
  const top    = entry.candidates[0];
  const others = entry.candidates.slice(1).filter(c => c.confidence >= CANDIDATE_MIN_PCT);

  const candidatesHtml = [
    _renderCandidateRow(top, true),
    ...others.map(c => _renderCandidateRow(c, false)),
  ].join('');

  const noteNames = entry.detectedNotes.map(pc => NOTE_NAMES[pc]).join(' ');

  const hint = _getDiagnosticHint(
    { candidates: entry.candidates },
    0,
    new Map(entry.detectedNotes.map(pc => [pc, { hits: 1, avgConfidence: 0.9 }]))
  );

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
        ${_playbackButton()}
        ${_waveformToggleButton()}
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

  // ── Single note entry ───────────────────────────────────────
  if ((!entry.candidates || entry.candidates.length === 0) && entry.isSingleNote && entry.dominantNote) {
    const n = entry.dominantNote;
    return `
      <div class="detect-card detect-history${faded}">
        <div class="detect-history-header">
          <span class="detect-label">Single Note</span>
          <span class="detect-prev-time">${age}</span>
        </div>
        <p class="detect-single-note-msg">
          Detected <strong>${n.noteName}${n.octave}</strong>
        </p>
      </div>`;
  }

  if (!entry.candidates || entry.candidates.length === 0) return '';

  // ── Chord entry ─────────────────────────────────────────────
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

/* ── Shared button helpers ─────────────────────────────────── */

function _playbackButton() {
  if (!latestCaptureBuffer) return '';
  return `<button class="detect-playback-btn" id="detect-playback-btn"
                  data-listener-action="toggle-playback">
            \u25B6 Play back
          </button>`;
}

function _waveformToggleButton() {
  return `<button class="detect-waveform-toggle"
                  data-listener-action="toggle-waveform">
            ${waveformVisible ? 'Hide waveform' : 'Show waveform'}
          </button>`;
}

/* ── Diagnostic hints ──────────────────────────────────────── */

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

/* ── Playback ──────────────────────────────────────────────── */

function _playCapture() {
  if (!latestCaptureBuffer) return;
  _stopPlayback();

  const { samples, sampleRate } = latestCaptureBuffer;
  const startSample = Math.floor((scrubSelection.startMs / 1000) * sampleRate);
  const endSample   = Math.floor((scrubSelection.endMs   / 1000) * sampleRate);
  const region      = samples.slice(startSample, endSample);

  let ctx;
  try {
    ctx = (micManager && micManager.getContext()) || new AudioContext();
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
    try { playbackSource.stop(); } catch (_) {}
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

/* ── Waveform / scrub ──────────────────────────────────────── */

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

  canvas.width = canvas.offsetWidth || 300;

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

  const isDark = document.documentElement.classList.contains('dark');
  ctx.fillStyle = isDark ? '#1e1c24' : '#f0ece6';
  ctx.fillRect(0, 0, w, h);

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

  ctx.fillStyle = isDark ? '#3a3050' : '#c5b8d8';
  for (let i = 0; i < w; i++) {
    const barH = (points[i] / maxVal) * (h * 0.8);
    ctx.fillRect(i, (h - barH) / 2, 1, barH);
  }

  const totalMs   = durationMs;
  const selStartX = (scrubSelection.startMs / totalMs) * w;
  const selEndX   = (scrubSelection.endMs   / totalMs) * w;

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, selStartX, h);
  ctx.fillRect(selEndX, 0, w - selEndX, h);

  ctx.strokeStyle = '#6a50a0';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(selStartX, 0); ctx.lineTo(selStartX, h);
  ctx.moveTo(selEndX,   0); ctx.lineTo(selEndX,   h);
  ctx.stroke();

  ctx.fillStyle = '#6a50a0';
  ctx.fillRect(selStartX - 6, 0, 12, h);
  ctx.fillRect(selEndX   - 6, 0, 12, h);
}

function _attachScrubListeners(canvas) {
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
      scrubSelection.startMs = Math.max(0, Math.min(scrubSelection.endMs - MIN_SELECTION_MS,
                                                    scrubDragStartMs + dMs));
    } else if (scrubDragEdge === 'end') {
      scrubSelection.endMs = Math.min(totalMs, Math.max(scrubSelection.startMs + MIN_SELECTION_MS,
                                                        scrubDragStartMs + dMs));
    } else {
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

  fresh.addEventListener('mousedown',  e => { onDown(e.clientX); });
  window.addEventListener('mousemove', e => { if (scrubDragging) onMove(e.clientX); });
  window.addEventListener('mouseup',   () => onUp());

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

  setStateLabel('Re-analysing\u2026');

  setTimeout(() => {
    const { samples, sampleRate } = latestCaptureBuffer;
    const startSample = Math.floor((scrubSelection.startMs / 1000) * sampleRate);
    const endSample   = Math.floor((scrubSelection.endMs   / 1000) * sampleRate);

    const subBuffer = {
      samples:    samples.slice(startSample, endSample),
      sampleRate,
      durationMs: scrubSelection.endMs - scrubSelection.startMs,
    };

    const analysis  = pitchAnalyser.analyseDeep(subBuffer);
    let matchResult = null;
    if (analysis.pitchClasses.size >= 2) {
      matchResult = matcher.match(analysis.pitchClasses);
    }

    _updateLatestEntry(matchResult, analysis);
    setStateLabel('');
    _renderResults();
  }, 0);
}

/* ── Time helpers ──────────────────────────────────────────── */

function _relativeTime(timestamp) {
  const sec = Math.round((Date.now() - timestamp) / 1000);
  if (sec < 5)  return 'just now';
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}

function _isOld(timestamp) {
  return (Date.now() - timestamp) > 30000;
}
