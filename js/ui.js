// ===== UI MODULE =====
// All DOM rendering: piano, fretboard, pickers, result area, progressions, circle of fifths

import {
  NOTE_NAMES, ROOTS, CHORD_TYPES, CHORD_SYMBOLS, INVERSION_NAMES,
  SHARP_DISPLAY, MAJOR_SCALE, MAJOR_DIATONIC, MINOR_SCALE, MINOR_DIATONIC,
  CIRCLE_OF_FIFTHS, useFlats, noteName, chordNotes, chordNoteNames,
  getInversion, chordSymbol, validate
} from './music-theory.js';

import { renderChordDiagram, rateVoicingDifficulty } from './fretboard.js';
import { PRESETS } from './sound-presets.js';
import { playNotes, isSamplerReady, setLoadProgressCallback, setCurrentInstrument, applySoundParams } from './audio-engine.js';

// ---- State (owned by this module, exposed via getters/setters) ----
let selectedRoot = null;
let selectedType = null;
let selectedInversion = 0;
let instrumentMode = 'piano';
let progMode = 'major';
let activePreset = 'default';
let prevRoot = null;    // track for fade-on-chord-change
let prevType = null;
let skipFade = false;   // set true to bypass fade on next render

// ---- Public state accessors ----
export function getSelectedRoot() { return selectedRoot; }
export function getSelectedType() { return selectedType; }
export function getInstrumentMode() { return instrumentMode; }

// ===== PIANO RENDERER =====
function renderPiano(container, voicedSemis, rootSemi) {
  container.innerHTML = '';

  const whiteMap = [
    {note:'C',semi:0},{note:'D',semi:2},{note:'E',semi:4},{note:'F',semi:5},
    {note:'G',semi:7},{note:'A',semi:9},{note:'B',semi:11}
  ];
  const whites = [];
  for (let oct = 0; oct < 2; oct++) {
    whiteMap.forEach(w => whites.push({ ...w, oct, absSemi: w.semi + oct * 12 }));
  }

  const keyW = 100 / whites.length;
  const activeSet = new Set(voicedSemis);
  const rootMod = rootSemi % 12;

  // Octave divider
  const divider = document.createElement('div');
  divider.className = 'piano-octave-divider';
  divider.style.left = (7 * keyW - 0.15) + '%';
  container.appendChild(divider);

  whites.forEach((w, i) => {
    const el = document.createElement('div');
    el.className = 'wk';
    const isActive = activeSet.has(w.absSemi);
    const noteMod = w.absSemi % 12;

    if (isActive) {
      el.className += noteMod === rootMod ? ' on-root' : ' on';
    }

    el.style.left = (i * keyW) + '%';
    el.style.width = (keyW - 0.3) + '%';

    if (isActive) {
      const lbl = document.createElement('span');
      lbl.className = 'key-note-label';
      lbl.textContent = w.note;
      el.appendChild(lbl);
    }

    container.appendChild(el);
  });

  // Black keys
  const blackPositions = [
    {after: 0, semi: 1, note:'C\u266F'},
    {after: 1, semi: 3, note:'E\u266D'},
    {after: 3, semi: 6, note:'F\u266F'},
    {after: 4, semi: 8, note:'G\u266F'},
    {after: 5, semi: 10, note:'B\u266D'},
  ];

  for (let oct = 0; oct < 2; oct++) {
    blackPositions.forEach(bp => {
      const i = bp.after + oct * 7;
      if (i >= whites.length - 1) return;
      const el = document.createElement('div');
      el.className = 'bk';
      const absSemi = bp.semi + oct * 12;
      const isActive = activeSet.has(absSemi);
      const noteMod = absSemi % 12;

      if (isActive) {
        el.className += noteMod === rootMod ? ' on-root' : ' on';
      }

      el.style.left = ((i + 1) * keyW - keyW * 0.28) + '%';
      el.style.width = (keyW * 0.56) + '%';

      if (isActive) {
        const lbl = document.createElement('span');
        lbl.className = 'key-note-label';
        lbl.textContent = bp.note;
        el.appendChild(lbl);
      }

      container.appendChild(el);
    });
  }
}

// ===== RELATED CHORDS =====
function getRelatedChords(rootIdx, typeIdx) {
  const currentSemis = new Set(chordNotes(rootIdx, typeIdx));
  const results = [];

  for (let r = 0; r < ROOTS.length; r++) {
    for (let t = 0; t < CHORD_TYPES.length; t++) {
      if (r === rootIdx && t === typeIdx) continue;
      const semis = chordNotes(r, t);
      const shared = semis.filter(s => currentSemis.has(s)).length;
      if (shared >= 2) {
        results.push({ rootIdx: r, typeIdx: t, shared, symbol: chordSymbol(r, t) });
      }
    }
  }

  results.sort((a, b) => {
    if (b.shared !== a.shared) return b.shared - a.shared;
    const aDist = Math.min(Math.abs(a.rootIdx - rootIdx), 12 - Math.abs(a.rootIdx - rootIdx));
    const bDist = Math.min(Math.abs(b.rootIdx - rootIdx), 12 - Math.abs(b.rootIdx - rootIdx));
    return aDist - bDist;
  });

  return results.slice(0, 9);
}

function renderRelatedChords(rootIdx, typeIdx) {
  const related = getRelatedChords(rootIdx, typeIdx);
  if (related.length === 0) return '';

  let html = '<div class="related-section">';
  html += '<div class="related-title">Related Chords</div>';
  html += `<div class="related-sub">Chords sharing 2 or more notes with ${chordSymbol(rootIdx, typeIdx)}</div>`;
  html += '<div class="related-grid">';

  related.forEach(r => {
    const cls = r.shared >= 3 ? 'related-chip high-rel' : 'related-chip';
    html += `<div class="${cls}" data-nav-root="${r.rootIdx}" data-nav-type="${r.typeIdx}">`;
    html += `<span class="related-chip-name">${r.symbol}</span>`;
    html += `<span class="related-chip-shared">${r.shared} shared</span>`;
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

// ===== PROGRESSIONS =====
export function setProgMode(mode) {
  progMode = mode;
  renderProgressions();
}

export function renderProgressions() {
  const area = document.getElementById('progressions-area');
  if (!area) return;

  if (selectedRoot === null) {
    area.innerHTML = '';
    return;
  }

  const scale = progMode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  const diatonic = progMode === 'major' ? MAJOR_DIATONIC : MINOR_DIATONIC;
  const rootSemi = ROOTS[selectedRoot].semi;
  const rootN = noteName(rootSemi, selectedRoot);
  const modeName = progMode === 'major' ? 'Major' : 'Minor';

  let html = '<div class="progressions-section">';
  html += `<div class="prog-label">Diatonic chords in ${rootN} ${modeName}</div>`;

  html += '<div class="prog-mode-toggle">';
  html += `<button class="prog-mode-btn ${progMode==='major'?'active':''}" data-prog-mode="major">Major</button>`;
  html += `<button class="prog-mode-btn ${progMode==='minor'?'active':''}" data-prog-mode="minor">Minor</button>`;
  html += '</div>';

  html += '<div class="prog-row">';
  diatonic.forEach((deg, i) => {
    const degreeSemi = (rootSemi + scale[i]) % 12;
    const degRootIdx = ROOTS.findIndex(r => r.semi === degreeSemi);
    const degTypeIdx = CHORD_TYPES.findIndex(t => t.id === deg.typeId);
    if (degRootIdx < 0 || degTypeIdx < 0) return;

    const isActive = (degRootIdx === selectedRoot && degTypeIdx === selectedType);
    const sym = chordSymbol(degRootIdx, degTypeIdx);

    html += `<div class="prog-pill ${isActive ? 'active' : ''}" data-nav-root="${degRootIdx}" data-nav-type="${degTypeIdx}">`;
    html += `<span class="prog-roman">${deg.roman}</span>`;
    html += `<span class="prog-chord">${sym}</span>`;
    html += '</div>';
  });
  html += '</div></div>';

  area.innerHTML = html;
}

// ===== CIRCLE OF FIFTHS =====
export function renderCircleOfFifths() {
  const container = document.getElementById('circle-of-fifths');
  if (!container) return;

  const cx = 110, cy = 110, r = 90, nodeR = 18;
  const isDark = document.body.classList.contains('dark');

  let svg = `<svg viewBox="0 0 220 220" width="220" height="220" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${isDark ? '#2e2a38' : '#e8e4de'}" stroke-width="1.5"/>`;

  CIRCLE_OF_FIFTHS.forEach((rootIdx, i) => {
    const angle = (i * 30 - 90) * Math.PI / 180;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    const root = ROOTS[rootIdx];

    let fill, textFill, strokeCol;
    if (selectedRoot !== null) {
      const selSemi = ROOTS[selectedRoot].semi;
      const thisSemi = root.semi;
      const diff = ((thisSemi - selSemi) % 12 + 12) % 12;

      if (rootIdx === selectedRoot) {
        fill = '#6a50a0'; textFill = '#fff'; strokeCol = '#6a50a0';
      } else if (diff === 7 || diff === 5) {
        fill = isDark ? '#2a2040' : '#ece4f8';
        textFill = isDark ? '#b090e0' : '#6a50a0';
        strokeCol = isDark ? '#5a40a0' : '#c5b8d8';
      } else if (diff === 9 || diff === 3) {
        fill = isDark ? '#1e2030' : '#e8edf8';
        textFill = isDark ? '#8090c0' : '#5060a0';
        strokeCol = isDark ? '#405080' : '#b0bcd8';
      } else {
        fill = isDark ? '#1e1c28' : '#faf8f5';
        textFill = isDark ? '#6a6080' : '#8a8580';
        strokeCol = isDark ? '#3a3540' : '#e0dbd4';
      }
    } else {
      fill = isDark ? '#1e1c28' : '#faf8f5';
      textFill = isDark ? '#a098b8' : '#6a6560';
      strokeCol = isDark ? '#3a3540' : '#e0dbd4';
    }

    const displayLabel = root.black ? root.flatName : root.name;

    svg += `<g class="cof-node" data-cof-root="${rootIdx}">`;
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${nodeR}" fill="${fill}" stroke="${strokeCol}" stroke-width="1.5"/>`;
    svg += `<text class="cof-label" x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" font-size="${root.black ? 9 : 10.5}" fill="${textFill}">${displayLabel}</text>`;
    svg += '</g>';
  });

  svg += '</svg>';
  container.innerHTML = `<div class="cof-wrap">${svg}</div>`;
}

// ===== PICKERS =====
export function buildPickers() {
  const rootRow = document.getElementById('root-picker');
  const typeRow = document.getElementById('type-picker');

  ROOTS.forEach((r, i) => {
    const btn = document.createElement('button');
    btn.className = 'pill' + (r.black ? ' black-note' : '');
    btn.textContent = r.black ? (r.flatName + ' / ' + (SHARP_DISPLAY[r.name] || r.name)) : r.name;
    btn.dataset.rootIdx = i;
    btn.id = 'root-' + i;
    rootRow.appendChild(btn);
  });

  CHORD_TYPES.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.textContent = t.label;
    btn.dataset.typeIdx = i;
    btn.id = 'type-' + i;
    typeRow.appendChild(btn);
  });
}

// ===== PRESETS =====
export function buildPresetButtons() {
  const container = document.getElementById('preset-buttons');
  if (!container) return;
  const presets = PRESETS[instrumentMode] || PRESETS.piano;
  container.innerHTML = '';
  for (const [key, p] of Object.entries(presets)) {
    const btn = document.createElement('button');
    btn.className = 'sp-preset' + (key === activePreset ? ' active' : '');
    btn.dataset.preset = key;
    btn.textContent = p.label;
    container.appendChild(btn);
  }
}

// ===== INSTRUMENT TOGGLE =====
export function setInstrument(mode) {
  instrumentMode = mode;
  setCurrentInstrument(mode);
  activePreset = 'default';
  buildPresetButtons();
  applyPreset('default');
  renderResult();
}

// ===== SOUND PANEL =====
export function toggleSoundPanel() {
  document.getElementById('sound-panel').classList.toggle('open');
}

export function applyPreset(name) {
  const presets = PRESETS[instrumentMode] || PRESETS.piano;
  const p = presets[name];
  if (!p) return;
  activePreset = name;

  document.getElementById('sl-reverb').value = p.reverb;
  document.getElementById('sl-decay').value = p.decay;
  document.getElementById('sl-attack').value = p.attack;
  document.getElementById('sl-sustain').value = p.sustain;
  document.getElementById('sl-release').value = p.release;
  document.getElementById('sl-bright').value = p.bright;
  document.getElementById('sl-warm').value = p.warm;
  document.getElementById('sl-sub').value = p.sub;

  document.querySelectorAll('.sp-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === name);
  });

  onSoundChange();
}

export function onSoundChange() {
  const rv = parseInt(document.getElementById('sl-reverb').value);
  const dc = parseInt(document.getElementById('sl-decay').value);
  const at = parseInt(document.getElementById('sl-attack').value);
  const su = parseInt(document.getElementById('sl-sustain').value);
  const rl = parseInt(document.getElementById('sl-release').value);
  const br = parseInt(document.getElementById('sl-bright').value);
  const wm = parseInt(document.getElementById('sl-warm').value);
  const sb = parseInt(document.getElementById('sl-sub').value);

  // Update value labels
  document.getElementById('sv-reverb').textContent = rv + '%';
  document.getElementById('sv-decay').textContent = (dc / 10).toFixed(1) + 's';
  document.getElementById('sv-attack').textContent = (at * 10) + 'ms';
  document.getElementById('sv-sustain').textContent = su + '%';
  document.getElementById('sv-release').textContent = (rl / 10).toFixed(1) + 's';
  document.getElementById('sv-bright').textContent = br + '%';
  document.getElementById('sv-warm').textContent = wm + '%';
  document.getElementById('sv-sub').textContent = sb + '%';

  // Check if values match a preset
  activePreset = null;
  const curPresets = PRESETS[instrumentMode] || PRESETS.piano;
  for (const [name, p] of Object.entries(curPresets)) {
    if (p.reverb === rv && p.decay === dc && p.attack === at && p.sustain === su &&
        p.release === rl && p.bright === br && p.warm === wm && p.sub === sb) {
      activePreset = name;
      break;
    }
  }
  document.querySelectorAll('.sp-preset').forEach(btn => {
    btn.classList.toggle('active', activePreset && btn.dataset.preset === activePreset);
  });

  // Apply to audio engine
  applySoundParams({ rv, dc, at, su, rl, br, wm, sb });
}

// ===== NAVIGATE TO CHORD =====
export function navigateToChord(rootIdx, typeIdx) {
  selectedRoot = rootIdx;
  selectedType = typeIdx;
  selectedInversion = 0;
  document.querySelectorAll('#root-picker .pill').forEach((p, i) => p.classList.toggle('active', i === rootIdx));
  document.querySelectorAll('#type-picker .pill').forEach((p, i) => p.classList.toggle('active', i === typeIdx));
  renderResult();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== MAIN RENDER =====
export function selectRoot(i) {
  selectedRoot = i;
  selectedInversion = 0;
  document.querySelectorAll('#root-picker .pill').forEach((p, idx) => p.classList.toggle('active', idx === i));
  renderResult();
}

export function selectType(i) {
  selectedType = i;
  selectedInversion = 0;
  document.querySelectorAll('#type-picker .pill').forEach((p, idx) => p.classList.toggle('active', idx === i));
  renderResult();
}

export function selectInv(i) {
  selectedInversion = i;
  renderResult();
}

export function transpose(semitones) {
  if (selectedRoot === null) return;
  selectedRoot = ((selectedRoot + semitones) % 12 + 12) % 12;
  selectedInversion = 0;
  skipFade = true;
  document.querySelectorAll('#root-picker .pill').forEach((p, idx) => p.classList.toggle('active', idx === selectedRoot));
  renderResult();
}

export function renderResult() {
  const area = document.getElementById('result-area');

  if (selectedRoot === null || selectedType === null) {
    area.innerHTML = '<div class="empty-state"><span class="arrow">\u2191</span>Pick a root note and chord type to get started</div>';
    renderProgressions();
    renderCircleOfFifths();
    return;
  }

  updateURL();

  const type = CHORD_TYPES[selectedType];
  const inv = getInversion(selectedRoot, selectedType, selectedInversion);
  const symbol = chordSymbol(selectedRoot, selectedType);
  const msgs = validate(selectedRoot, selectedType);

  // Sample loading indicator
  let samplerNote = '';
  if (isSamplerReady(instrumentMode)) {
    samplerNote = `<span class="sampler-badge ready" title="Real instrument samples loaded">\u266B Sampled</span>`;
  }

  let html = '<div class="result-card">';

  // Title
  html += `<div class="chord-title">${symbol} ${samplerNote}</div>`;
  html += `<div class="chord-formula">${type.formula}</div>`;
  html += `<div class="chord-notes-text">${inv.names.join(' \u2013 ')}</div>`;

  // Play button
  html += `<button class="play-btn" data-semis="[${inv.semis.join(',')}]">
    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
    Play
  </button>`;

  // Transpose
  const intervals = [
    { label: '\u00BD step', semi: 1 },
    { label: 'Whole', semi: 2 },
    { label: 'Min 3rd', semi: 3 },
    { label: 'Maj 3rd', semi: 4 },
  ];
  html += '<div class="transpose-section">';
  html += '<div class="transpose-label">Transpose</div>';
  html += '<div class="transpose-row">';
  intervals.forEach(iv => {
    html += `<div class="transpose-group">`;
    html += `<button class="t-btn" data-transpose="${-iv.semi}" title="Down ${iv.label}">\u25C0</button>`;
    html += `<span class="t-label">${iv.label}</span>`;
    html += `<button class="t-btn" data-transpose="${iv.semi}" title="Up ${iv.label}">\u25B6</button>`;
    html += `</div>`;
  });
  html += '</div>';
  html += '<div class="transpose-hint">Shift the root up or down by a common interval</div>';
  html += '</div>';

  // Interval tags
  html += '<div class="interval-tags">';
  type.intervalNames.forEach((name, i) => {
    const cls = i === 0 ? 'interval-tag root-tag' : 'interval-tag';
    html += `<span class="${cls}">${name}</span>`;
  });
  html += '</div>';

  // Instrument toggle
  html += '<div class="inst-toggle">';
  html += `<button class="inst-btn ${instrumentMode==='piano'?'active':''}" data-instrument="piano">\uD83C\uDFB9 Piano</button>`;
  html += `<button class="inst-btn ${instrumentMode==='guitar'?'active':''}" data-instrument="guitar">\uD83C\uDFB8 Guitar</button>`;
  html += `<button class="inst-btn ${instrumentMode==='ukulele'?'active':''}" data-instrument="ukulele"><svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" style="vertical-align:-2px;margin-right:3px"><rect x="3.5" y="0" width="5" height="2.5" rx="1"/><rect x="5" y="2" width="2" height="4.5" rx="0.6"/><ellipse cx="6" cy="9" rx="2.8" ry="2.4"/><ellipse cx="6" cy="13" rx="3.8" ry="3.8"/></svg>Ukulele</button>`;
  html += '</div>';

  // Instrument display
  if (instrumentMode === 'piano') {
    html += '<div class="piano-container" id="main-piano"></div>';
  } else {
    html += '<div id="chord-diagram"></div>';
  }

  // Validation messages
  if (msgs.length > 0) {
    html += '<div class="callout">';
    html += msgs.map(m => `<strong>\u26A1</strong> ${m}`).join('<br style="margin-bottom:0.3rem">');
    html += '</div>';
  }

  html += '</div>';

  // Inversions
  const numNotes = type.intervals.length;
  html += '<div class="inversions-section">';
  html += '<div class="inv-title">Inversions</div>';
  html += '<div class="inv-sub">Same notes, different bottom note \u2014 changes the colour of the chord</div>';
  html += '<div class="inv-cards">';

  for (let v = 0; v < numNotes; v++) {
    const invData = getInversion(selectedRoot, selectedType, v);
    const isActive = v === selectedInversion;

    let diffHtml = '';
    let tipHtml = '';
    if (instrumentMode === 'guitar' || instrumentMode === 'ukulele') {
      const diff = rateVoicingDifficulty(invData.semis, instrumentMode);
      const dots = Array.from({length: 4}, (_, d) =>
        `<span class="diff-dot ${d < diff.score ? 'filled' : ''}"></span>`
      ).join('');
      diffHtml = `<span class="diff-badge ${diff.cssClass}"><span class="diff-dots">${dots}</span> ${diff.label}</span>`;
      if (diff.tip) tipHtml = `<div class="inv-tip">${diff.tip}</div>`;
    }

    html += `<div class="inv-card ${isActive ? 'active' : ''}" data-inv="${v}">`;
    html += '<div class="inv-card-header">';
    html += `<span class="inv-name">${INVERSION_NAMES[v]}</span>`;
    html += `<span class="inv-badge">${invData.bassNote} in bass</span>`;
    html += diffHtml;
    html += '</div>';
    html += `<div class="inv-notes">${invData.names.join(' \u2013 ')}</div>`;
    html += tipHtml;
    html += '</div>';
  }

  html += '</div></div>';

  // Related chords
  html += renderRelatedChords(selectedRoot, selectedType);

  // Did the actual chord change (root or type), or just inversion/instrument?
  const chordChanged = (selectedRoot !== prevRoot || selectedType !== prevType);
  prevRoot = selectedRoot;
  prevType = selectedType;

  const doSwap = () => {
    area.innerHTML = html;

    // Render instrument display
    if (instrumentMode === 'piano') {
      const pianoEl = document.getElementById('main-piano');
      if (pianoEl) renderPiano(pianoEl, inv.voicedSemis, ROOTS[selectedRoot].semi);
    } else {
      const diagEl = document.getElementById('chord-diagram');
      if (diagEl) renderChordDiagram(diagEl, inv.semis, instrumentMode, selectedRoot);
    }

    // Only re-render these when the chord itself changed (not on inversion/instrument switch)
    if (chordChanged) {
      renderProgressions();
      renderCircleOfFifths();
    }

    if (chordChanged) {
      requestAnimationFrame(() => area.classList.remove('fading-out'));
    }
  };

  // Only fade on chord changes (not transpose, inversion, or instrument switches)
  const shouldFade = chordChanged && !skipFade && area.innerHTML && !area.classList.contains('fading-out');
  skipFade = false;

  if (shouldFade) {
    area.classList.add('fading-out');
    setTimeout(doSwap, 140);
  } else {
    doSwap();
  }
}

// ===== URL STATE =====
function updateURL() {
  if (selectedRoot === null || selectedType === null) return;
  history.replaceState(null, '', '#' + selectedRoot + '-' + CHORD_TYPES[selectedType].id);
}

export function restoreFromURL() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const dashIdx = hash.indexOf('-');
  if (dashIdx < 0) return;
  const rootIdx = parseInt(hash.slice(0, dashIdx));
  const typeId = hash.slice(dashIdx + 1);
  const typeIdx = CHORD_TYPES.findIndex(t => t.id === typeId);
  if (!isNaN(rootIdx) && rootIdx >= 0 && rootIdx < 12 && typeIdx >= 0) {
    selectedRoot = rootIdx;
    selectedType = typeIdx;
    document.querySelectorAll('#root-picker .pill').forEach((p, i) => p.classList.toggle('active', i === rootIdx));
    document.querySelectorAll('#type-picker .pill').forEach((p, i) => p.classList.toggle('active', i === typeIdx));
    renderResult();
  }
}

// ===== DARK MODE =====
export function toggleDark() {
  document.body.classList.toggle('dark');
  const dark = document.body.classList.contains('dark');
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = dark ? '\u2600\uFE0F' : '\uD83C\uDF19';
  renderCircleOfFifths(); // re-render with correct colors
}

// ===== COF CLICK =====
export function cofClick(rootIdx) {
  selectedRoot = rootIdx;
  document.querySelectorAll('#root-picker .pill').forEach((p, i) => p.classList.toggle('active', i === rootIdx));
  if (selectedType === null) {
    selectedType = 0;
    document.querySelectorAll('#type-picker .pill').forEach((p, i) => p.classList.toggle('active', i === 0));
  }
  selectedInversion = 0;
  renderResult();
}

// ===== LOADING INDICATOR =====
export function showLoadingIndicator(instrument, status, pct) {
  let el = document.getElementById('sample-loading');
  if (!el) return;

  if (status === 'ready' || status === 'error') {
    el.classList.add('hidden');
    // Re-render to show sampler badge
    if (status === 'ready' && selectedRoot !== null && selectedType !== null) {
      renderResult();
    }
    return;
  }

  el.classList.remove('hidden');
  const fill = document.getElementById('loading-fill');
  const text = document.getElementById('loading-text');
  if (fill) fill.style.width = pct + '%';
  const names = { piano: 'piano', guitar: 'guitar', ukulele: 'ukulele' };
  if (text) text.textContent = `Loading ${names[instrument] || instrument} samples...`;
}
