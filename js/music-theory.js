// ===== MUSIC THEORY ENGINE =====
export const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Enharmonic display names (prefer flats for certain roots)
export const FLAT_MAP = { 'C#':'D♭', 'D#':'E♭', 'F#':'G♭', 'G#':'A♭', 'A#':'B♭' };
export const SHARP_DISPLAY = { 'C#':'C♯', 'D#':'D♯', 'F#':'F♯', 'G#':'G♯', 'A#':'A♯' };

// Roots that prefer flat spelling
export const FLAT_ROOTS = new Set(['F','Bb','Eb','Ab','Db','Gb','D#','G#','A#','C#','F#']);

export const ROOTS = [
  { name: 'C', semi: 0, black: false },
  { name: 'C#', semi: 1, black: true, flatName: 'D♭' },
  { name: 'D', semi: 2, black: false },
  { name: 'D#', semi: 3, black: true, flatName: 'E♭' },
  { name: 'E', semi: 4, black: false },
  { name: 'F', semi: 5, black: false },
  { name: 'F#', semi: 6, black: true, flatName: 'G♭' },
  { name: 'G', semi: 7, black: false },
  { name: 'G#', semi: 8, black: true, flatName: 'A♭' },
  { name: 'A', semi: 9, black: false },
  { name: 'A#', semi: 10, black: true, flatName: 'B♭' },
  { name: 'B', semi: 11, black: false },
];

// Chord definitions: [semitones from root], formula name, interval names
export const CHORD_TYPES = [
  { id: 'maj',     label: 'Major',       intervals: [0,4,7],      formula: 'R – M3 – P5',      intervalNames: ['Root','Major 3rd','Perfect 5th'] },
  { id: 'min',     label: 'Minor',       intervals: [0,3,7],      formula: 'R – m3 – P5',      intervalNames: ['Root','Minor 3rd','Perfect 5th'] },
  { id: 'dim',     label: 'Dim',         intervals: [0,3,6],      formula: 'R – m3 – dim5',    intervalNames: ['Root','Minor 3rd','Dim 5th'] },
  { id: 'aug',     label: 'Aug',         intervals: [0,4,8],      formula: 'R – M3 – aug5',    intervalNames: ['Root','Major 3rd','Aug 5th'] },
  { id: 'dom7',    label: 'Dom 7',       intervals: [0,4,7,10],   formula: 'R – M3 – P5 – m7', intervalNames: ['Root','Major 3rd','Perfect 5th','Minor 7th'] },
  { id: 'maj7',    label: 'Maj 7',       intervals: [0,4,7,11],   formula: 'R – M3 – P5 – M7', intervalNames: ['Root','Major 3rd','Perfect 5th','Major 7th'] },
  { id: 'min7',    label: 'Min 7',       intervals: [0,3,7,10],   formula: 'R – m3 – P5 – m7', intervalNames: ['Root','Minor 3rd','Perfect 5th','Minor 7th'] },
  { id: 'dim7',    label: 'Dim 7',       intervals: [0,3,6,9],    formula: 'R – m3 – d5 – d7', intervalNames: ['Root','Minor 3rd','Dim 5th','Dim 7th'] },
  { id: 'hdim7',   label: 'Half-dim 7',  intervals: [0,3,6,10],   formula: 'R – m3 – d5 – m7', intervalNames: ['Root','Minor 3rd','Dim 5th','Minor 7th'] },
  { id: 'sus2',    label: 'Sus 2',       intervals: [0,2,7],      formula: 'R – M2 – P5',      intervalNames: ['Root','Major 2nd','Perfect 5th'] },
  { id: 'sus4',    label: 'Sus 4',       intervals: [0,5,7],      formula: 'R – P4 – P5',      intervalNames: ['Root','Perfect 4th','Perfect 5th'] },
  { id: '7sus4',   label: '7sus4',       intervals: [0,5,7,10],   formula: 'R – P4 – P5 – m7', intervalNames: ['Root','Perfect 4th','Perfect 5th','Minor 7th'] },
  { id: 'maj6',    label: 'Maj 6',       intervals: [0,4,7,9],    formula: 'R – M3 – P5 – M6', intervalNames: ['Root','Major 3rd','Perfect 5th','Major 6th'] },
  { id: 'min6',    label: 'Min 6',       intervals: [0,3,7,9],    formula: 'R – m3 – P5 – M6', intervalNames: ['Root','Minor 3rd','Perfect 5th','Major 6th'] },
  { id: 'dom9',    label: 'Dom 9',       intervals: [0,4,7,10,2], formula: 'R – M3 – P5 – m7 – M9', intervalNames: ['Root','Major 3rd','Perfect 5th','Minor 7th','Major 9th'] },
  { id: 'maj9',    label: 'Maj 9',       intervals: [0,4,7,11,2], formula: 'R – M3 – P5 – M7 – M9', intervalNames: ['Root','Major 3rd','Perfect 5th','Major 7th','Major 9th'] },
  { id: 'min9',    label: 'Min 9',       intervals: [0,3,7,10,2], formula: 'R – m3 – P5 – m7 – M9', intervalNames: ['Root','Minor 3rd','Perfect 5th','Minor 7th','Major 9th'] },
  { id: 'add9',    label: 'Add 9',       intervals: [0,4,7,2],    formula: 'R – M3 – P5 – M9', intervalNames: ['Root','Major 3rd','Perfect 5th','Major 9th'] },
  { id: 'pow',     label: 'Power',       intervals: [0,7],        formula: 'R – P5',           intervalNames: ['Root','Perfect 5th'] },
];

// Chord symbol suffixes
export const CHORD_SYMBOLS = {
  maj: '', min: 'm', dim: '°', aug: '+',
  dom7: '7', maj7: 'maj7', min7: 'm7',
  dim7: '°7', hdim7: 'ø7', sus2: 'sus2', sus4: 'sus4',
  '7sus4': '7sus4', maj6: '6', min6: 'm6',
  dom9: '9', maj9: 'maj9', min9: 'm9', add9: 'add9', pow: '5'
};

export const INVERSION_NAMES = ['Root position', '1st inversion', '2nd inversion', '3rd inversion'];

// ===== DIATONIC PROGRESSIONS =====
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MAJOR_DIATONIC = [
  { roman: 'I',    typeId: 'maj' },
  { roman: 'ii',   typeId: 'min' },
  { roman: 'iii',  typeId: 'min' },
  { roman: 'IV',   typeId: 'maj' },
  { roman: 'V',    typeId: 'maj' },
  { roman: 'vi',   typeId: 'min' },
  { roman: 'vii°', typeId: 'dim' },
];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
export const MINOR_DIATONIC = [
  { roman: 'i',    typeId: 'min' },
  { roman: 'ii°',  typeId: 'dim' },
  { roman: 'III',  typeId: 'maj' },
  { roman: 'iv',   typeId: 'min' },
  { roman: 'v',    typeId: 'min' },
  { roman: 'VI',   typeId: 'maj' },
  { roman: 'VII',  typeId: 'maj' },
];

// Circle of fifths order (indices into ROOTS: C, G, D, A, E, B, F#, Db, Ab, Eb, Bb, F)
export const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// Spoke index for each semitone (maps semitone → position on the wheel)
export const SEMI_TO_SPOKE = (() => {
  const m = {};
  CIRCLE_OF_FIFTHS.forEach((semi, i) => m[semi] = i);
  return m;
})();

// All keys on the spiral of fifths — 3 laps expanding outward
// Ring 0: standard 12 keys  |  Ring 1: enharmonic twins  |  Ring 2: double-sharp/double-flat
export const SPIRAL_KEYS = [
  // Ring 0 — standard circle of fifths (12 keys)
  { name: 'C',  semi: 0,  acc: 0,   ring: 0, theoretical: false },
  { name: 'G',  semi: 7,  acc: 1,   ring: 0, theoretical: false },
  { name: 'D',  semi: 2,  acc: 2,   ring: 0, theoretical: false },
  { name: 'A',  semi: 9,  acc: 3,   ring: 0, theoretical: false },
  { name: 'E',  semi: 4,  acc: 4,   ring: 0, theoretical: false },
  { name: 'B',  semi: 11, acc: 5,   ring: 0, theoretical: false },
  { name: 'F\u266F', semi: 6,  acc: 6,   ring: 0, theoretical: false },
  { name: 'D\u266D', semi: 1,  acc: -5,  ring: 0, theoretical: false },
  { name: 'A\u266D', semi: 8,  acc: -4,  ring: 0, theoretical: false },
  { name: 'E\u266D', semi: 3,  acc: -3,  ring: 0, theoretical: false },
  { name: 'B\u266D', semi: 10, acc: -2,  ring: 0, theoretical: false },
  { name: 'F',  semi: 5,  acc: -1,  ring: 0, theoretical: false },
  // Ring 1 — enharmonic twins & single-accidental extensions (12 keys)
  // Sharp arm (continuing clockwise from F♯)
  { name: 'C\u266F',           semi: 1,  acc: 7,   ring: 1, theoretical: false, twinOf: 'D\u266D' },
  { name: 'G\u266F',           semi: 8,  acc: 8,   ring: 1, theoretical: true,  twinOf: 'A\u266D' },
  { name: 'D\u266F',           semi: 3,  acc: 9,   ring: 1, theoretical: true,  twinOf: 'E\u266D' },
  { name: 'A\u266F',           semi: 10, acc: 10,  ring: 1, theoretical: true,  twinOf: 'B\u266D' },
  { name: 'E\u266F',           semi: 5,  acc: 11,  ring: 1, theoretical: true,  twinOf: 'F' },
  { name: 'B\u266F',           semi: 0,  acc: 12,  ring: 1, theoretical: true,  twinOf: 'C' },
  // Flat arm (continuing counter-clockwise from D♭)
  { name: 'G\u266D',           semi: 6,  acc: -6,  ring: 1, theoretical: false, twinOf: 'F\u266F' },
  { name: 'C\u266D',           semi: 11, acc: -7,  ring: 1, theoretical: false, twinOf: 'B' },
  { name: 'F\u266D',           semi: 4,  acc: -8,  ring: 1, theoretical: true,  twinOf: 'E' },
  { name: 'B\u266D\u266D',     semi: 9,  acc: -9,  ring: 1, theoretical: true,  twinOf: 'A' },
  { name: 'E\u266D\u266D',     semi: 2,  acc: -10, ring: 1, theoretical: true,  twinOf: 'D' },
  { name: 'A\u266D\u266D',     semi: 7,  acc: -11, ring: 1, theoretical: true,  twinOf: 'G' },
  // Ring 2 — double sharps (\u00D7) & double flats (11 keys)
  // Sharp arm (continuing from B♯)
  { name: 'F\u00D7',           semi: 7,  acc: 13,  ring: 2, theoretical: true,  twinOf: 'G' },
  { name: 'C\u00D7',           semi: 2,  acc: 14,  ring: 2, theoretical: true,  twinOf: 'D' },
  { name: 'G\u00D7',           semi: 9,  acc: 15,  ring: 2, theoretical: true,  twinOf: 'A' },
  { name: 'D\u00D7',           semi: 4,  acc: 16,  ring: 2, theoretical: true,  twinOf: 'E' },
  { name: 'A\u00D7',           semi: 11, acc: 17,  ring: 2, theoretical: true,  twinOf: 'B' },
  { name: 'E\u00D7',           semi: 6,  acc: 18,  ring: 2, theoretical: true,  twinOf: 'F\u266F' },
  { name: 'B\u00D7',           semi: 1,  acc: 19,  ring: 2, theoretical: true,  twinOf: 'D\u266D' },
  // Spoke 8 omitted — would require triple accidentals (Pythagorean comma boundary)
  // Flat arm (continuing from A♭♭)
  { name: 'D\u266D\u266D',     semi: 0,  acc: -12, ring: 2, theoretical: true,  twinOf: 'C' },
  { name: 'G\u266D\u266D',     semi: 5,  acc: -13, ring: 2, theoretical: true,  twinOf: 'F' },
  { name: 'C\u266D\u266D',     semi: 10, acc: -14, ring: 2, theoretical: true,  twinOf: 'B\u266D' },
  { name: 'F\u266D\u266D',     semi: 3,  acc: -15, ring: 2, theoretical: true,  twinOf: 'E\u266D' },
];

// ===== HELPERS =====
export function useFlats(rootIdx, preferFlat) {
  // If an explicit preference is provided, use it
  if (preferFlat != null) return preferFlat;
  // Otherwise fall back to auto-detection
  const r = ROOTS[rootIdx].name;
  return FLAT_ROOTS.has(r) || ROOTS[rootIdx].black;
}

export function noteName(semiFromC, rootIdx, preferFlat) {
  const idx = ((semiFromC % 12) + 12) % 12;
  const raw = NOTE_NAMES[idx];
  if (raw.length === 1) return raw;
  // sharp or flat based on root context
  if (useFlats(rootIdx, preferFlat)) {
    return FLAT_MAP[raw] || raw;
  }
  return SHARP_DISPLAY[raw] || raw;
}

export function chordNotes(rootIdx, typeIdx) {
  const root = ROOTS[rootIdx].semi;
  const type = CHORD_TYPES[typeIdx];
  return type.intervals.map(i => (root + i) % 12);
}

export function chordNoteNames(rootIdx, typeIdx, preferFlat) {
  const semis = chordNotes(rootIdx, typeIdx);
  return semis.map(s => noteName(s, rootIdx, preferFlat));
}

export function getInversion(rootIdx, typeIdx, inv, preferFlat) {
  const names = chordNoteNames(rootIdx, typeIdx, preferFlat);
  const semis = chordNotes(rootIdx, typeIdx);
  // Rotate
  const rNames = [...names.slice(inv), ...names.slice(0, inv)];
  const rSemis = [...semis.slice(inv), ...semis.slice(0, inv)];
  // Build voiced semis — ascending from the bass note
  // Each note must be >= the previous; if not, bump it up an octave
  const voiced = [rSemis[0]];
  for (let i = 1; i < rSemis.length; i++) {
    let s = rSemis[i];
    while (s <= voiced[i - 1]) s += 12;
    voiced.push(s);
  }
  return { names: rNames, semis: rSemis, voicedSemis: voiced, bassNote: rNames[0] };
}

export function chordSymbol(rootIdx, typeIdx, preferFlat) {
  const rootDisplay = ROOTS[rootIdx].black && useFlats(rootIdx, preferFlat)
    ? ROOTS[rootIdx].flatName
    : (SHARP_DISPLAY[ROOTS[rootIdx].name] || ROOTS[rootIdx].name);
  return rootDisplay + CHORD_SYMBOLS[CHORD_TYPES[typeIdx].id];
}

// Validation: check for special properties
export function validate(rootIdx, typeIdx) {
  const type = CHORD_TYPES[typeIdx];
  const notes = [];
  const msgs = [];

  // Check for symmetric chord
  if (type.id === 'dim7') {
    msgs.push('Symmetry: This dim7 splits the octave into 4 equal minor thirds. All 4 notes can be the root, giving 4 enharmonic names for the same chord.');
  }
  if (type.id === 'aug') {
    msgs.push('Symmetry: This augmented triad splits the octave into 3 equal major thirds. All 3 notes can be the root.');
  }

  // Check for tritone
  if (type.intervals.includes(6)) {
    msgs.push('Contains a tritone (6 semitones) — the most dissonant interval, creating tension that wants to resolve.');
  }

  // Perfect fifth check
  if (!type.intervals.includes(7) && type.id !== 'aug') {
    msgs.push('No perfect 5th — gives this chord its unstable, unresolved character.');
  }

  return msgs;
}
