# Chord Explorer — Code Map

Quick-reference for every file, function, constant, and CSS section in the project.

---

## index.html

| Line | Section |
|------|---------|
| 1-8 | HEAD (meta, stylesheet link) |
| 11 | Theme toggle button |
| 14-15 | Title + tagline |
| 18-27 | Picker section (root, type, circle of fifths container) |
| 30 | `#progressions-area` (rendered dynamically) |
| 33 | `#sequence-area` (rendered dynamically) |
| 36-39 | Sample loading indicator |
| 42-94 | Sound settings panel (sliders, presets) |
| 97-102 | `#result-area` (main chord display) |
| 105-117 | AudioWorklet patch script |
| 118 | Tone.js CDN |
| 119 | `<script type="module" src="js/app.js">` |

---

## js/app.js — Entry point & event delegation

*Imports from: ui.js, audio-engine.js, sequence.js*

| Line | Function | Purpose |
|------|----------|---------|
| 54 | `lazyInitAudio()` | Creates AudioContext on first user gesture |
| 68 | `checkReplaceMode()` | After picker click, replaces selected sequence chord |
| 78+ | click delegation | Routes all clicks by `data-*` attributes |
| 186+ | drag delegation | HTML5 drag + touch drag for sequence reorder |

---

## js/music-theory.js — Pure data & functions (no state)

### Constants

| Line | Export | Description |
|------|--------|-------------|
| 2 | `NOTE_NAMES` | `['C','C#','D',...]` |
| 5 | `FLAT_MAP` | Sharp-to-flat display mapping |
| 6 | `SHARP_DISPLAY` | Sharp display names |
| 9 | `FLAT_ROOTS` | Set of root indices that use flats |
| 11 | `ROOTS` | 12 root objects `{name, semi}` |
| 27 | `CHORD_TYPES` | 19 chord type definitions `{id, name, intervals, semitones}` |
| 50 | `CHORD_SYMBOLS` | Display symbols per chord type |
| 58 | `INVERSION_NAMES` | `['Root position', '1st inversion', ...]` |
| 61 | `MAJOR_SCALE` | `[0, 2, 4, 5, 7, 9, 11]` |
| 62 | `MAJOR_DIATONIC` | 7 diatonic chords `{roman, typeId}` |
| 71 | `MINOR_SCALE` | `[0, 2, 3, 5, 7, 8, 10]` |
| 72 | `MINOR_DIATONIC` | 7 diatonic chords `{roman, typeId}` |
| 83 | `CIRCLE_OF_FIFTHS` | `[0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]` |

### Functions

| Line | Export | Signature | Returns |
|------|--------|-----------|---------|
| 86 | `useFlats` | `(rootIdx)` | boolean |
| 92 | `noteName` | `(semi, rootIdx)` | string |
| 103 | `chordNotes` | `(rootIdx, typeIdx)` | number[] |
| 109 | `chordNoteNames` | `(rootIdx, typeIdx)` | string[] |
| 114 | `getInversion` | `(rootIdx, typeIdx, inv)` | `{names, semis, voicedSemis, bassNote}` |
| 131 | `chordSymbol` | `(rootIdx, typeIdx)` | string |
| 139 | `validate` | `(rootIdx, typeIdx)` | string[] |

---

## js/ui.js — State, rendering, DOM

### State variables

| Line | Variable | Type | Description |
|------|----------|------|-------------|
| 16 | `selectedRoot` | number\|null | Index into ROOTS |
| 17 | `selectedType` | number\|null | Index into CHORD_TYPES |
| 18 | `selectedInversion` | number | Current inversion (0-based) |
| 19 | `instrumentMode` | string | `'piano'`, `'guitar'`, or `'ukulele'` |
| 20 | `progMode` | string | `'major'` or `'minor'` |
| 21 | `activePreset` | string | Current sound preset name |
| 22 | `prevRoot` | number\|null | Previous root (for fade detection) |
| 23 | `prevType` | number\|null | Previous type (for fade detection) |
| 24 | `skipFade` | boolean | Bypass fade on next render |

### Exported functions

| Line | Function | Purpose |
|------|----------|---------|
| 27 | `getSelectedRoot()` | Accessor |
| 28 | `getSelectedType()` | Accessor |
| 29 | `getInstrumentMode()` | Accessor |
| 163 | `setProgMode(mode)` | Toggle major/minor progressions |
| 168 | `renderProgressions()` | Diatonic chord pills |
| 212 | `renderCircleOfFifths()` | SVG circle of fifths |
| 268 | `buildPickers()` | Root + type pill rows |
| 292 | `buildPresetButtons()` | Sound preset buttons |
| 307 | `setInstrument(mode)` | Switch piano/guitar/uke |
| 317 | `toggleSoundPanel()` | Expand/collapse sound settings |
| 321 | `applyPreset(name)` | Apply a sound preset |
| 343 | `onSoundChange()` | Read sliders, update audio params |
| 382 | `navigateToChord(root, type)` | Set state + render (related chords, progressions) |
| 393 | `selectRoot(i)` | Root picker click |
| 400 | `selectType(i)` | Type picker click |
| 407 | `selectInv(i)` | Inversion click |
| 412 | `transpose(semitones)` | Shift root by interval (no fade) |
| 421 | `renderResult()` | **Main render** — builds result HTML, piano, diagram |
| 593 | `restoreFromURL()` | Parse hash on load |
| 611 | `toggleDark()` | Theme toggle |
| 621 | `cofClick(rootIdx)` | Circle of fifths click |
| 633 | `showLoadingIndicator()` | Sample loading bar |

### Internal functions

| Line | Function | Purpose |
|------|----------|---------|
| 32 | `renderPiano(container, voicedSemis, rootSemi)` | Draws 2-octave piano |
| 116 | `getRelatedChords(rootIdx, typeIdx)` | Finds chords sharing 2+ notes |
| 141 | `renderRelatedChords(rootIdx, typeIdx)` | HTML for related chords |
| 588 | `updateURL()` | Hash state sync |

---

## js/audio-engine.js — Tone.js synth & sampler

### State variables

| Line | Variable | Description |
|------|----------|-------------|
| 9 | `synthLayers` | Array of PolySynth layers |
| 10 | `reverb` | Tone.Freeverb instance |
| 11 | `compressor` | Tone.Compressor instance |
| 12 | `audioReady` | Boolean — synths built? |
| 13 | `pendingPlay` | Semis queued before audio ready |
| 14 | `rawCtx` | Raw AudioContext |
| 17 | `samplers` | `{piano: Sampler, guitar: Sampler, ...}` |
| 18 | `samplerReady` | `{piano: bool, guitar: bool, ...}` |
| 19 | `samplerReverb` | Tone.Reverb (HTTPS only) |
| 20 | `samplerCompressor` | Compressor for sampler chain |
| 21 | `currentInstrument` | Which instrument is active |
| 24 | `onLoadProgress` | Callback for loading UI |
| 28 | `SAMPLE_BASE` | CDN base URL for samples |
| 31 | `SAMPLE_MAPS` | Sample note maps per instrument |

### Exported functions

| Line | Function | Purpose |
|------|----------|---------|
| 56 | `isAudioReady()` | Accessor |
| 58 | `setLoadProgressCallback(cb)` | UI hooks into loading progress |
| 60 | `setCurrentInstrument(inst)` | Triggers sampler loading |
| 70 | `ensureContext()` | Creates AudioContext (needs user gesture) |
| 82 | `finishAudioSetup()` | Builds synth layers + starts sample loading |
| 108 | `onUserGesture()` | Resume suspended context + fire pending play |
| 124 | `playNotes(semis)` | Public play (handles unlock flow) |
| 140 | `applySoundParams(params)` | Updates reverb/envelope/chorus from sliders |
| 338 | `isSamplerReady(instrument)` | Check if samples loaded |

### Internal functions

| Line | Function | Purpose |
|------|----------|---------|
| 183 | `initSynthLayers()` | 3-layer synth + effects chain |
| 246 | `loadSampler(instrument)` | Tone.Sampler from CDN samples |
| 292 | `midiToNoteName(midi)` | MIDI number to "C4" string |
| 298 | `doPlayNotes(semis)` | Actual playback (sampler or synth fallback) |

---

## js/sequence.js — Chord sequence builder

### State variables

| Line | Variable | Description |
|------|----------|-------------|
| 8 | `sequence` | Array of `{rootIdx, typeIdx, id}` |
| 9 | `selectedSeqIdx` | Selected chip index (null = none) |
| 10 | `undoStack` | Previous sequence snapshots |
| 11 | `redoStack` | Redo snapshots |
| 12 | `nextId` | Monotonic ID for drag stability |
| 13 | `isPlaying` | Playback in progress? |
| 14 | `playTimeouts` | setTimeout IDs for cancellation |
| 144 | `dragFromIdx` | Source index during HTML5 drag |
| 206-210 | `touchDragIdx`, `touchClone`, etc. | Touch drag state |

### Exported functions

| Line | Function | Purpose |
|------|----------|---------|
| 25 | `addChord(rootIdx, typeIdx)` | Push to sequence |
| 32 | `removeChord(idx)` | Splice from sequence |
| 43 | `replaceChord(idx, root, type)` | Swap chord at position |
| 51 | `reorderSequence(from, to)` | Drag-drop reorder |
| 64 | `clearSequence()` | Empty all |
| 72 | `undo()` | Pop undo stack |
| 80 | `redo()` | Pop redo stack |
| 88 | `getSelectedSeqIdx()` | Accessor |
| 90 | `setSelectedSeqIdx(idx)` | Toggle chip selection |
| 99 | `isSequenceSelecting()` | Is a chip selected for replace? |
| 103 | `getSequenceLength()` | Accessor |
| 105 | `stopPlayback()` | Cancel play-all |
| 114 | `playAll()` | Sequential playback with chip highlighting |
| 146 | `onDragStart(e, idx)` | HTML5 dragstart handler |
| 157 | `onDragOver(e)` | HTML5 dragover handler |
| 179 | `onDrop(e)` | HTML5 drop handler |
| 194 | `onDragEnd()` | HTML5 dragend handler |
| 212 | `onTouchStart(e, idx)` | Mobile touch drag start |
| 220 | `onTouchMove(e)` | Mobile touch drag move |
| 262 | `onTouchEnd(e)` | Mobile touch drag end |
| 288 | `renderSequence()` | Builds sequence UI into #sequence-area |

### Internal functions

| Line | Function | Purpose |
|------|----------|---------|
| 17 | `pushUndo()` | Snapshot current sequence to undo stack |
| 199 | `clearDragStyles()` | Remove all drag CSS classes |

---

## js/fretboard.js — Guitar/uke voicing & diagrams

| Line | Export | Purpose |
|------|--------|---------|
| 4 | `TUNINGS` | MIDI tunings `{guitar: [...], ukulele: [...]}` |
| 9 | `STRING_LABELS` | String name labels |
| 15 | `findVoicing(semis, instrument)` | Finds best fret positions for chord |
| 117 | `renderChordDiagram(container, semis, inst, root)` | SVG fretboard diagram |
| 212 | `rateVoicingDifficulty(semis, instrument)` | Easy / Medium / Hard rating |

---

## js/sound-presets.js — Instrument presets

| Line | Export | Purpose |
|------|--------|---------|
| 1 | `PRESETS` | `{piano: {default, warm, bright, ...}, guitar: {...}, ukulele: {...}}` |

---

## css/styles.css — Section index

| Line | Section |
|------|---------|
| 30 | Picker |
| 91 | Result Card |
| 149 | Piano |
| 225 | Inversions |
| 289 | Difficulty Badge |
| 339 | Error |
| 346 | Callout |
| 370 | Audio btn (Play) |
| 391 | Transpose |
| 466 | Sound Settings |
| 636 | Instrument Toggle |
| 668 | Chord Diagram |
| 679 | Theme toggle |
| 699 | Related Chords |
| 754 | Dark Mode |
| 873 | Progressions |
| 976 | Sequence Builder |
| 1188 | Circle of Fifths |
| 1209 | Smooth Transitions |
| 1219 | Sample Loading |
| 1236 | Sampler Badge |
