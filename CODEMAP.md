# Chord Explorer — Code Map

Quick-reference for every file, function, constant, and CSS section.
**Keep this updated when adding/modifying files, functions, or sections.**

---

## index.html

| Line | Section |
|------|---------|
| 1-8 | HEAD (meta, stylesheet link) |
| 11-12 | Theme toggle button |
| 14-15 | Title + tagline |
| 18-24 | Picker section (root + type pickers, always visible) |
| 27-34 | Desktop tab bar (Explorer, Sequence, Listener, Settings) |
| 37-57 | Tab content panels |
| 38-47 | `#tab-explorer` (circle of fifths, progressions, result area) |
| 49-62 | `#tab-sequence` (own chord picker + sequence area) |
| 64-66 | `#tab-listener` (listener area) |
| 68-97 | `#tab-settings` (sound sliders, presets — always open) |
| 100-115 | Mobile bottom tab bar (fixed, native app style) |
| 118-121 | Sample loading indicator (fixed position, global) |
| 123-131 | AudioWorklet patch script |
| 132 | Tone.js CDN |
| 133 | `<script type="module" src="js/app.js">` |

---

## js/tabs.js — Tab system

| Line | Export | Purpose |
|------|--------|---------|
| 8 | `switchTab(tabId)` | Switches active tab panel + button states |
| 35 | `getActiveTab()` | Returns active tab ID string |

Tab IDs: `'explorer'`, `'sequence'`, `'listener'`, `'settings'`

---

## js/app.js — Entry point & event delegation

*Imports from: ui.js, audio-engine.js, sequence.js, listener/listener-ui.js, tabs.js*

| Line | Function / Section | Purpose |
|------|----------|---------|
| 38-40 | `buildPickers()`, `buildSequencePicker()`, `buildPresetButtons()` | Initial UI setup |
| 52 | `restoreFromURL()` | Restore state from URL hash |
| 58 | `renderSequence()` | Initial sequence render |
| 61 | `renderListenerPanel()` | Initial listener panel render |
| 64 | `lazyInitAudio()` | Creates AudioContext on first user gesture (deferred synth setup) |
| 79-80 | `seqPickerRoot`, `seqPickerType` | Sequence picker state (independent from explorer) |
| 82 | `updateSeqAddBtn()` | Enable/disable sequence add button |
| 86+ | click delegation | Routes all clicks by `data-*` attributes |
| 88-91 | tab switching | `[data-tab]` clicks → `switchTab()` |
| 99-122 | sequence picker | `#seq-root-picker` / `#seq-type-picker` pill clicks |
| 125+ | sequence actions | `[data-seq-action]` routing |
| 160+ | explorer pickers | `#root-picker` / `#type-picker` pill clicks |
| 222+ | drag delegation | HTML5 drag + touch drag for sequence reorder |
| 252+ | slider input delegation | Sound setting slider changes |

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
| 27 | `CHORD_TYPES` | 19 chord type definitions `{id, label, intervals, formula, intervalNames}` |
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

*Imports from: music-theory.js, fretboard.js, sound-presets.js, audio-engine.js, tabs.js*

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
| 268 | `buildPickers()` | Root + type pill rows (explorer) |
| 290 | `buildSequencePicker()` | Root + type pill rows (sequence tab, `data-seq-*` attributes) |
| 310 | `buildPresetButtons()` | Sound preset buttons |
| 325 | `setInstrument(mode)` | Switch piano/guitar/uke |
| 335 | `toggleSoundPanel()` | Expand/collapse sound settings |
| 339 | `applyPreset(name)` | Apply a sound preset |
| 361 | `onSoundChange()` | Read sliders, update audio params |
| 400 | `navigateToChord(root, type)` | Set state + switch to Explorer tab + render |
| 411 | `selectRoot(i)` | Root picker click |
| 418 | `selectType(i)` | Type picker click |
| 425 | `selectInv(i)` | Inversion click |
| 430 | `transpose(semitones)` | Shift root by interval (no fade) |
| 439 | `renderResult()` | **Main render** — builds result HTML, piano, diagram |
| 606 | `restoreFromURL()` | Parse hash on load |
| 624 | `toggleDark()` | Theme toggle |
| 634 | `cofClick(rootIdx)` | Circle of fifths click |
| 646 | `showLoadingIndicator()` | Sample loading bar |

### Internal functions

| Line | Function | Purpose |
|------|----------|---------|
| 32 | `renderPiano(container, voicedSemis, rootSemi)` | Draws 2-octave piano with octave-aware voicing |
| 116 | `getRelatedChords(rootIdx, typeIdx)` | Finds chords sharing 2+ notes |
| 141 | `renderRelatedChords(rootIdx, typeIdx)` | HTML for related chords |
| 601 | `updateURL()` | Hash state sync |

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

## js/listener/ — Chord Listener (mic-based chord detection)

### js/listener/yin.js — YIN pitch detection algorithm

| Line | Export | Purpose |
|------|--------|---------|
| 18 | `yin(buffer, sampleRate, threshold)` | Estimates fundamental frequency. Returns `{frequency, confidence}` or `null` |

Algorithm: difference → cumulative mean normalised difference → absolute threshold → parabolic interpolation.
Detection range: ~75Hz–2000Hz.

### js/listener/mic-manager.js — Microphone access & AnalyserNode

| Line | Export | Purpose |
|------|--------|---------|
| 14 | `class MicManager` | Manages mic stream lifecycle |
| 41 | `.start()` | Requests raw mic (no echo/noise/gain processing), creates separate AudioContext + AnalyserNode (fftSize: 4096) |
| 85 | `.stop()` | Stops stream tracks, disconnects nodes, closes context |
| 111 | `.getAnalyser()` | Returns AnalyserNode |
| 116 | `.getSampleRate()` | Returns context sample rate |
| 121 | `.isActive()` | Boolean status |

Key: Separate AudioContext from Tone.js. Raw audio (echoCancellation/noiseSuppression/autoGainControl all disabled). Not connected to destination (no feedback).

### js/listener/note-accumulator.js — Rolling window note collector

| Export | Purpose |
|--------|---------|
| `class NoteAccumulator` | Collects pitch detections over rolling time window |
| `.addDetection(midi, confidence, timestamp)` | Records detection, prunes old entries |
| `.getActiveNotes()` | Returns `Set<number>` of pitch classes (0-11) with >= minHits |
| `.reset()` | Clears all detections |

Config: `windowMs: 600`, `minHits: 3`.

### js/listener/chord-matcher.js — Note set → chord identification

| Export | Purpose |
|--------|---------|
| `class ChordMatcher` | Pre-computes all root×type candidates, scores against detected notes |
| `.match(activeNotes)` | Returns `{rootIdx, typeIdx, score, confidence, altMatch}` or `null` |

Scoring: +2 hit, -1 missing, -0.5 extra, +1 root bonus. Min score ≥ 3. Stars: 1-4.

### js/listener/listener-ui.js — Panel UI & detection loop

| Line | Export | Purpose |
|------|--------|---------|
| 44 | `renderListenerPanel()` | Renders listener into `#listener-area` (no collapsible — has own tab) |
| 77 | `toggleMic()` | Start/stop mic + detection loop |
| 149 | `applyHistoryChord(r, t)` | Navigate explorer to a history chord |
| 155 | `clearHistory()` | Clear chord history log |
| 167 | `handleListenerClick(action, target)` | Routes `data-listener-action` clicks |

Internal: `rms()`, `fftPeaks()` (polyphonic FFT peak detection), `listenLoop()` (rAF loop with amplitude gate + YIN + FFT), `updateDisplay()`, `logChord()`, `renderHistory()`, `confidenceStars()`.

State: `chordHistory[]` (max 30), `lastLoggedChord`, `stableMatchStart`, `STABLE_MS: 400`, `AMP_GATE: 0.04`.

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
| 5 | Body + page |
| 12 | Tab System (desktop bar, panels, mobile bottom bar, sequence picker) |
| 140 | Picker |
| 200 | Result Card |
| 260 | Piano |
| 335 | Inversions |
| 400 | Difficulty Badge |
| 450 | Error |
| 457 | Callout |
| 480 | Audio btn (Play) |
| 500 | Transpose |
| 575 | Sound Settings |
| 745 | Instrument Toggle |
| 778 | Chord Diagram |
| 790 | Theme toggle |
| 810 | Related Chords |
| 876 | Dark Mode (+ tab dark mode) |
| 1000 | Progressions |
| 1100 | Sequence Builder |
| 1310 | Circle of Fifths |
| 1330 | Smooth Transitions |
| 1340 | Sample Loading (fixed toast) |
| 1360 | Sampler Badge |
| 1385 | Chord Listener Panel (level bar, history, live status) |
