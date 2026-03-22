// ===== APP ENTRY POINT =====
// Wires up state, events, and initialization.

import {
  buildPickers, buildPresetButtons, renderResult, renderProgressions,
  renderCircleOfFifths, restoreFromURL, toggleDark, toggleSoundPanel,
  setInstrument, applyPreset, onSoundChange, navigateToChord,
  selectRoot, selectType, selectInv, transpose, cofClick,
  setProgMode, showLoadingIndicator, getSelectedRoot, getSelectedType
} from './ui.js';

import {
  ensureContext, finishAudioSetup, onUserGesture, playNotes,
  setLoadProgressCallback
} from './audio-engine.js';

import {
  addChord, removeChord, replaceChord, clearSequence,
  undo, redo, playAll, stopPlayback,
  setSelectedSeqIdx, isSequenceSelecting, getSelectedSeqIdx,
  renderSequence,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onTouchStart, onTouchMove, onTouchEnd
} from './sequence.js';

import {
  renderListenerPanel, handleListenerClick
} from './listener/listener-ui.js';

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

// ---- Initial sequence render ----
renderSequence();

// ---- Initial listener panel render ----
renderListenerPanel();

// ---- Lazy audio init on first user gesture ----
let audioInited = false;
function lazyInitAudio() {
  if (audioInited) return;
  audioInited = true;
  ensureContext();
  finishAudioSetup();
  ['click', 'touchstart', 'touchend', 'mousedown', 'keydown'].forEach(evt => {
    document.removeEventListener(evt, lazyInitAudio, true);
  });
}
['click', 'touchstart', 'touchend', 'mousedown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, lazyInitAudio, { capture: true, passive: true });
});

// ---- Helper: after root/type selection, handle replace mode ----
function checkReplaceMode() {
  if (isSequenceSelecting()) {
    const root = getSelectedRoot();
    const type = getSelectedType();
    if (root !== null && type !== null) {
      replaceChord(getSelectedSeqIdx(), root, type);
    }
  }
}

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

  // ---- Sequence actions ----
  const seqAction = e.target.closest('[data-seq-action]');
  if (seqAction) {
    const action = seqAction.dataset.seqAction;
    if (action === 'add') {
      const root = getSelectedRoot();
      const type = getSelectedType();
      if (root !== null && type !== null) {
        addChord(root, type);
      }
    } else if (action === 'undo') { undo(); }
    else if (action === 'redo') { redo(); }
    else if (action === 'clear') { clearSequence(); }
    else if (action === 'play-all') { playAll(); }
    else if (action === 'stop') { stopPlayback(); }
    else if (action === 'cancel-replace') { setSelectedSeqIdx(null); }
    return;
  }

  // Sequence chip remove button
  const seqRemove = e.target.closest('[data-seq-remove]');
  if (seqRemove) {
    removeChord(parseInt(seqRemove.dataset.seqRemove));
    return;
  }

  // Sequence chip click (select for replacement)
  const seqChip = e.target.closest('.seq-chip[data-seq-idx]');
  if (seqChip && !e.target.closest('[data-seq-remove]')) {
    setSelectedSeqIdx(parseInt(seqChip.dataset.seqIdx));
    return;
  }

  // Root picker pill
  const rootPill = e.target.closest('#root-picker .pill');
  if (rootPill && rootPill.dataset.rootIdx !== undefined) {
    selectRoot(parseInt(rootPill.dataset.rootIdx));
    checkReplaceMode();
    return;
  }

  // Type picker pill
  const typePill = e.target.closest('#type-picker .pill');
  if (typePill && typePill.dataset.typeIdx !== undefined) {
    selectType(parseInt(typePill.dataset.typeIdx));
    checkReplaceMode();
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

  // Listener panel actions
  const listenerAction = e.target.closest('[data-listener-action]');
  if (listenerAction) {
    handleListenerClick(listenerAction.dataset.listenerAction, listenerAction);
    return;
  }
}, { passive: false });

// ---- Drag-and-drop delegation (HTML5 + touch) ----
document.addEventListener('dragstart', function(e) {
  const chip = e.target.closest('.seq-chip[data-seq-idx]');
  if (chip) onDragStart(e, parseInt(chip.dataset.seqIdx));
});
document.addEventListener('dragover', function(e) {
  if (e.target.closest('.seq-chips')) onDragOver(e);
});
document.addEventListener('drop', function(e) {
  if (e.target.closest('.seq-chips')) onDrop(e);
});
document.addEventListener('dragend', function(e) {
  onDragEnd();
});

// Touch drag for mobile
document.addEventListener('touchstart', function(e) {
  const chip = e.target.closest('.seq-chip[data-seq-idx]');
  if (chip && !e.target.closest('[data-seq-remove]')) {
    onTouchStart(e, parseInt(chip.dataset.seqIdx));
  }
}, { passive: true });
document.addEventListener('touchmove', function(e) {
  onTouchMove(e);
}, { passive: false });
document.addEventListener('touchend', function(e) {
  onTouchEnd(e);
}, { passive: true });

// ---- Slider input events ----
document.addEventListener('input', function(e) {
  if (e.target.classList.contains('sp-slider')) {
    onSoundChange();
  }
});
