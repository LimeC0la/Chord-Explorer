// ===== CHORD SEQUENCE BUILDER =====
// Manages a user-built chord sequence with drag-reorder, select-to-replace, undo/redo, and play-all.

import { chordSymbol, chordNotes } from './music-theory.js';
import { playNotes } from './audio-engine.js';

// ---- State ----
let sequence = [];           // Array of { rootIdx, typeIdx, id }
let selectedSeqIdx = null;   // Which chip is selected for replacement (null = none)
let undoStack = [];
let redoStack = [];
let nextId = 1;
let isPlaying = false;
let playTimeouts = [];       // So we can cancel playback

// ---- Undo helpers ----
function pushUndo() {
  undoStack.push(sequence.map(c => ({ ...c })));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

// ---- Public API ----

export function addChord(rootIdx, typeIdx) {
  pushUndo();
  sequence.push({ rootIdx, typeIdx, id: nextId++ });
  selectedSeqIdx = null;
  renderSequence();
}

export function removeChord(idx) {
  if (idx < 0 || idx >= sequence.length) return;
  pushUndo();
  sequence.splice(idx, 1);
  if (selectedSeqIdx !== null) {
    if (selectedSeqIdx === idx) selectedSeqIdx = null;
    else if (selectedSeqIdx > idx) selectedSeqIdx--;
  }
  renderSequence();
}

export function replaceChord(idx, rootIdx, typeIdx) {
  if (idx < 0 || idx >= sequence.length) return;
  pushUndo();
  sequence[idx] = { rootIdx, typeIdx, id: sequence[idx].id };
  selectedSeqIdx = null;
  renderSequence();
}

export function reorderSequence(fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= sequence.length) return;
  if (toIdx < 0 || toIdx > sequence.length) return;
  pushUndo();
  const [item] = sequence.splice(fromIdx, 1);
  // Adjust target if source was before target
  const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
  sequence.splice(adjustedTo, 0, item);
  selectedSeqIdx = null;
  renderSequence();
}

export function clearSequence() {
  if (sequence.length === 0) return;
  pushUndo();
  sequence = [];
  selectedSeqIdx = null;
  renderSequence();
}

export function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(sequence.map(c => ({ ...c })));
  sequence = undoStack.pop();
  selectedSeqIdx = null;
  renderSequence();
}

export function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(sequence.map(c => ({ ...c })));
  sequence = redoStack.pop();
  selectedSeqIdx = null;
  renderSequence();
}

export function getSelectedSeqIdx() { return selectedSeqIdx; }

export function setSelectedSeqIdx(idx) {
  if (idx === selectedSeqIdx) {
    selectedSeqIdx = null; // toggle off
  } else {
    selectedSeqIdx = idx;
  }
  renderSequence();
}

export function isSequenceSelecting() {
  return selectedSeqIdx !== null && selectedSeqIdx < sequence.length;
}

export function getSequenceLength() { return sequence.length; }

export function stopPlayback() {
  playTimeouts.forEach(t => clearTimeout(t));
  playTimeouts = [];
  isPlaying = false;
  // Clear playing highlights
  document.querySelectorAll('.seq-chip.playing').forEach(el => el.classList.remove('playing'));
  renderSequence();
}

export function playAll() {
  if (sequence.length === 0 || isPlaying) return;
  isPlaying = true;
  renderSequence();

  const intervalMs = 800;

  sequence.forEach((chord, i) => {
    const t = setTimeout(() => {
      const semis = chordNotes(chord.rootIdx, chord.typeIdx);
      playNotes(semis);
      // Highlight current chip
      document.querySelectorAll('.seq-chip').forEach((el, j) => {
        el.classList.toggle('playing', j === i);
      });
    }, i * intervalMs);
    playTimeouts.push(t);
  });

  // Clean up after last chord
  const endT = setTimeout(() => {
    isPlaying = false;
    playTimeouts = [];
    document.querySelectorAll('.seq-chip.playing').forEach(el => el.classList.remove('playing'));
    renderSequence();
  }, sequence.length * intervalMs + 400);
  playTimeouts.push(endT);
}

// ---- Drag and Drop ----
let dragFromIdx = null;

export function onDragStart(e, idx) {
  dragFromIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(idx));
  // Delay adding class so the drag image isn't affected
  requestAnimationFrame(() => {
    const chip = e.target.closest('.seq-chip');
    if (chip) chip.classList.add('dragging');
  });
}

export function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const chip = e.target.closest('.seq-chip');
  if (!chip) return;

  // Clear all drag indicators
  document.querySelectorAll('.seq-chip').forEach(c => {
    c.classList.remove('drag-over-left', 'drag-over-right');
  });

  // Determine left/right side
  const rect = chip.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  if (e.clientX < midX) {
    chip.classList.add('drag-over-left');
  } else {
    chip.classList.add('drag-over-right');
  }
}

export function onDrop(e) {
  e.preventDefault();
  const chip = e.target.closest('.seq-chip');
  if (!chip || dragFromIdx === null) return;

  const toIdx = parseInt(chip.dataset.seqIdx);
  const rect = chip.getBoundingClientRect();
  const midX = rect.left + rect.width / 2;
  const insertIdx = e.clientX < midX ? toIdx : toIdx + 1;

  reorderSequence(dragFromIdx, insertIdx);
  dragFromIdx = null;
  clearDragStyles();
}

export function onDragEnd() {
  dragFromIdx = null;
  clearDragStyles();
}

function clearDragStyles() {
  document.querySelectorAll('.seq-chip').forEach(c => {
    c.classList.remove('dragging', 'drag-over-left', 'drag-over-right');
  });
}

// ---- Touch drag support ----
let touchDragIdx = null;
let touchClone = null;
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;

export function onTouchStart(e, idx) {
  touchDragIdx = idx;
  touchMoved = false;
  const touch = e.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}

export function onTouchMove(e) {
  if (touchDragIdx === null) return;
  const touch = e.touches[0];
  const dx = Math.abs(touch.clientX - touchStartX);
  const dy = Math.abs(touch.clientY - touchStartY);

  // Only start drag if moved enough horizontally
  if (!touchMoved && dx < 10 && dy < 10) return;
  touchMoved = true;
  e.preventDefault();

  // Create floating clone on first move
  if (!touchClone) {
    const chip = document.querySelector(`.seq-chip[data-seq-idx="${touchDragIdx}"]`);
    if (!chip) return;
    chip.classList.add('dragging');
    touchClone = chip.cloneNode(true);
    touchClone.className = 'seq-chip touch-drag-clone';
    touchClone.style.position = 'fixed';
    touchClone.style.zIndex = '10000';
    touchClone.style.pointerEvents = 'none';
    touchClone.style.width = chip.offsetWidth + 'px';
    document.body.appendChild(touchClone);
  }

  touchClone.style.left = (touch.clientX - 30) + 'px';
  touchClone.style.top = (touch.clientY - 20) + 'px';

  // Highlight drop target
  document.querySelectorAll('.seq-chip').forEach(c => {
    c.classList.remove('drag-over-left', 'drag-over-right');
  });
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const targetChip = el && el.closest('.seq-chip');
  if (targetChip && !targetChip.classList.contains('touch-drag-clone')) {
    const rect = targetChip.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (touch.clientX < midX) targetChip.classList.add('drag-over-left');
    else targetChip.classList.add('drag-over-right');
  }
}

export function onTouchEnd(e) {
  if (touchClone) {
    touchClone.remove();
    touchClone = null;
  }

  if (touchDragIdx !== null && touchMoved) {
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const targetChip = el && el.closest('.seq-chip');
    if (targetChip) {
      const toIdx = parseInt(targetChip.dataset.seqIdx);
      const rect = targetChip.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const insertIdx = touch.clientX < midX ? toIdx : toIdx + 1;
      reorderSequence(touchDragIdx, insertIdx);
    }
  }

  touchDragIdx = null;
  touchMoved = false;
  clearDragStyles();
}

// ---- Render ----

export function renderSequence() {
  const area = document.getElementById('sequence-area');
  if (!area) return;

  // Always show the section once it has been used, or show empty state
  let html = '<div class="seq-section">';

  // Header
  html += '<div class="seq-header">';
  html += '<span class="seq-title">Sequence Builder</span>';
  html += '<div class="seq-actions">';

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const hasChords = sequence.length > 0;

  html += `<button class="seq-btn" data-seq-action="undo" ${canUndo ? '' : 'disabled'} title="Undo">↩</button>`;
  html += `<button class="seq-btn" data-seq-action="redo" ${canRedo ? '' : 'disabled'} title="Redo">↪</button>`;
  html += `<button class="seq-btn" data-seq-action="clear" ${hasChords ? '' : 'disabled'}>Clear</button>`;

  if (isPlaying) {
    html += `<button class="seq-btn seq-stop-btn" data-seq-action="stop">Stop</button>`;
  } else {
    html += `<button class="seq-btn seq-play-btn" data-seq-action="play-all" ${hasChords ? '' : 'disabled'}>Play All</button>`;
  }

  html += '</div></div>';

  // Replace mode banner
  if (selectedSeqIdx !== null && selectedSeqIdx < sequence.length) {
    const name = chordSymbol(sequence[selectedSeqIdx].rootIdx, sequence[selectedSeqIdx].typeIdx);
    html += `<div class="seq-replace-banner">Replacing <strong>${name}</strong> — pick a new chord above, or <button class="seq-cancel-btn" data-seq-action="cancel-replace">cancel</button></div>`;
  }

  // Chips
  html += '<div class="seq-chips" id="seq-chips">';
  if (sequence.length === 0) {
    html += '<div class="seq-empty">Add chords to build a sequence</div>';
  } else {
    sequence.forEach((chord, i) => {
      const name = chordSymbol(chord.rootIdx, chord.typeIdx);
      const sel = i === selectedSeqIdx ? ' selected' : '';
      html += `<div class="seq-chip${sel}" draggable="true" data-seq-idx="${i}" data-seq-id="${chord.id}">`;
      html += `<span class="seq-chip-num">${i + 1}</span>`;
      html += `<span class="seq-chip-name">${name}</span>`;
      html += `<button class="seq-chip-remove" data-seq-remove="${i}" title="Remove">&times;</button>`;
      html += '</div>';
    });
  }
  html += '</div>';

  // Add button
  html += `<button class="seq-add-btn" data-seq-action="add">+ Add Current Chord</button>`;

  html += '</div>';
  area.innerHTML = html;
}
