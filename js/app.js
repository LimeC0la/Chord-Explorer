// ===== APP ENTRY POINT =====
// Wires up state, events, and initialization.

import {
  buildPickers, buildPresetButtons, renderResult, renderProgressions,
  renderCircleOfFifths, restoreFromURL, toggleDark, toggleSoundPanel,
  setInstrument, applyPreset, onSoundChange, navigateToChord,
  selectRoot, selectType, selectInv, transpose, cofClick,
  setProgMode, showLoadingIndicator, getSelectedRoot
} from './ui.js';

import {
  ensureContext, finishAudioSetup, onUserGesture, playNotes,
  setLoadProgressCallback
} from './audio-engine.js';

// ---- Wire up loading indicator ----
setLoadProgressCallback(showLoadingIndicator);

// ---- Build UI ----
buildPickers();
buildPresetButtons();

// ---- Restore dark mode ----
if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = '\u2600\uFE0F';
}

// ---- Restore from URL ----
restoreFromURL();

// ---- Initial render if no URL state ----
if (getSelectedRoot() === null) {
  renderCircleOfFifths();
  renderProgressions();
}

// ---- Lazy audio init on first user gesture ----
// Browsers require a user gesture before AudioContext can start.
// We silently set up audio on the first click/tap/key — no overlay needed.
let audioInited = false;
function lazyInitAudio() {
  if (audioInited) return;
  audioInited = true;
  ensureContext();
  finishAudioSetup();
  // Remove listeners once audio is ready
  ['click', 'touchstart', 'touchend', 'mousedown', 'keydown'].forEach(evt => {
    document.removeEventListener(evt, lazyInitAudio, true);
  });
}
['click', 'touchstart', 'touchend', 'mousedown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, lazyInitAudio, { capture: true, passive: true });
});

// ---- Event delegation ----
document.addEventListener('click', function(e) {
  // Play button
  const playBtn = e.target.closest('.play-btn');
  if (playBtn) {
    const semisStr = playBtn.getAttribute('data-semis');
    if (semisStr) {
      e.preventDefault();
      playNotes(JSON.parse(semisStr));
    }
    return;
  }

  // Root picker pill
  const rootPill = e.target.closest('#root-picker .pill');
  if (rootPill && rootPill.dataset.rootIdx !== undefined) {
    selectRoot(parseInt(rootPill.dataset.rootIdx));
    return;
  }

  // Type picker pill
  const typePill = e.target.closest('#type-picker .pill');
  if (typePill && typePill.dataset.typeIdx !== undefined) {
    selectType(parseInt(typePill.dataset.typeIdx));
    return;
  }

  // Inversion card
  const invCard = e.target.closest('.inv-card[data-inv]');
  if (invCard) {
    selectInv(parseInt(invCard.dataset.inv));
    return;
  }

  // Transpose button
  const tBtn = e.target.closest('.t-btn[data-transpose]');
  if (tBtn) {
    transpose(parseInt(tBtn.dataset.transpose));
    return;
  }

  // Instrument toggle
  const instBtn = e.target.closest('.inst-btn[data-instrument]');
  if (instBtn) {
    setInstrument(instBtn.dataset.instrument);
    return;
  }

  // Sound panel toggle
  const spToggle = e.target.closest('.sound-panel-toggle');
  if (spToggle) {
    toggleSoundPanel();
    return;
  }

  // Theme toggle
  const themeBtn = e.target.closest('#theme-toggle');
  if (themeBtn) {
    toggleDark();
    return;
  }

  // Preset button
  const presetBtn = e.target.closest('.sp-preset[data-preset]');
  if (presetBtn) {
    applyPreset(presetBtn.dataset.preset);
    return;
  }

  // Navigate to chord (related chords, progressions)
  const navChord = e.target.closest('[data-nav-root][data-nav-type]');
  if (navChord) {
    navigateToChord(parseInt(navChord.dataset.navRoot), parseInt(navChord.dataset.navType));
    return;
  }

  // Circle of fifths node
  const cofNode = e.target.closest('[data-cof-root]');
  if (cofNode) {
    cofClick(parseInt(cofNode.dataset.cofRoot));
    return;
  }

  // Progression mode toggle
  const progBtn = e.target.closest('[data-prog-mode]');
  if (progBtn) {
    setProgMode(progBtn.dataset.progMode);
    return;
  }
}, { passive: false });

// ---- Slider input events ----
document.addEventListener('input', function(e) {
  if (e.target.classList.contains('sp-slider')) {
    onSoundChange();
  }
});
