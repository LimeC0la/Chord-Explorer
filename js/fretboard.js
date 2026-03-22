// ===== FRETBOARD ENGINE =====
import { noteName } from './music-theory.js';

export const TUNINGS = {
  guitar:  [40, 45, 50, 55, 59, 64], // E2 A2 D3 G3 B3 E4 (MIDI)
  ukulele: [67, 60, 64, 69]           // G4 C4 E4 A4 (MIDI, re-entrant)
};

export const STRING_LABELS = {
  guitar:  ['E','A','D','G','B','e'],
  ukulele: ['G','C','E','A']
};

// Find best playable voicing for a chord on a fretboard
export function findVoicing(chordSemis, instrument) {
  const tuning = TUNINGS[instrument];
  const numStrings = tuning.length;
  const noteSet = new Set(chordSemis.map(s => s % 12));
  const rootSemi = chordSemis[0] % 12;
  const maxFret = 15;

  // For each string, find all frets (0..maxFret) that produce a chord tone
  const options = tuning.map(openMidi => {
    const frets = [];
    for (let f = 0; f <= maxFret; f++) {
      const semi = (openMidi + f) % 12;
      if (noteSet.has(semi)) {
        frets.push({ fret: f, semi, isRoot: semi === rootSemi });
      }
    }
    return frets;
  });

  // Try to find a voicing within a fret span (max 4 frets for guitar, 4 for uke)
  const maxSpan = 4;
  let bestVoicing = null;
  let bestScore = -Infinity;

  // Try each starting fret position (including open)
  for (let startFret = 0; startFret <= 12; startFret++) {
    const voicing = []; // one entry per string: { fret, semi, isRoot } or null (muted)
    let coveredNotes = new Set();

    for (let s = 0; s < numStrings; s++) {
      // Find best option on this string within the span (or open)
      let best = null;
      let bestFretScore = -100;

      for (const opt of options[s]) {
        const inSpan = opt.fret === 0 || (opt.fret >= startFret && opt.fret < startFret + maxSpan);
        if (!inSpan) continue;
        // Score: prefer root on low strings, prefer open, prefer lower frets
        let score = 0;
        if (opt.isRoot && s < numStrings / 2) score += 5;
        if (opt.fret === 0) score += 2;
        score -= opt.fret * 0.1;
        if (score > bestFretScore) {
          bestFretScore = score;
          best = opt;
        }
      }

      voicing.push(best); // null = muted
      if (best) coveredNotes.add(best.semi);
    }

    // Score this voicing
    // Must cover all chord tones
    if (coveredNotes.size < noteSet.size) continue;

    let score = 0;
    let mutedCount = 0;
    let lowestPlayed = -1;

    for (let s = 0; s < numStrings; s++) {
      if (!voicing[s]) {
        mutedCount++;
        // Penalize muted strings in the middle
        if (lowestPlayed >= 0) score -= 3;
      } else {
        if (lowestPlayed < 0) lowestPlayed = s;
        if (voicing[s].fret === 0) score += 1;
        if (voicing[s].isRoot && s === lowestPlayed) score += 4;
      }
    }
    score -= mutedCount;
    // Prefer lower positions
    score -= startFret * 0.3;
    // Prefer fewer muted low strings
    for (let s = 0; s < numStrings; s++) {
      if (!voicing[s]) score -= 0.5;
      else break;
    }

    if (score > bestScore) {
      bestScore = score;
      bestVoicing = voicing;
    }
  }

  // Fallback: if no voicing found, try allowing more muted strings
  if (!bestVoicing) {
    bestVoicing = tuning.map((openMidi, s) => {
      for (let f = 0; f <= 5; f++) {
        if (noteSet.has((openMidi + f) % 12)) {
          return { fret: f, semi: (openMidi + f) % 12, isRoot: (openMidi + f) % 12 === rootSemi };
        }
      }
      return null;
    });
  }

  return bestVoicing;
}

// Render SVG chord diagram
export function renderChordDiagram(container, chordSemis, instrument, rootIdx) {
  const voicing = findVoicing(chordSemis, instrument);
  const tuning = TUNINGS[instrument];
  const labels = STRING_LABELS[instrument];
  const numStrings = tuning.length;
  const numFrets = 5;

  // Determine fret range to show
  const playedFrets = voicing.filter(v => v && v.fret > 0).map(v => v.fret);
  let minFret = playedFrets.length ? Math.min(...playedFrets) : 1;
  let maxFret = playedFrets.length ? Math.max(...playedFrets) : 4;

  // If all within first 4 frets, show from fret 1
  if (maxFret <= 4) {
    minFret = 1;
  } else {
    // Center the window
    minFret = Math.max(1, minFret);
  }
  const startFret = minFret;

  // SVG dimensions
  const stringSpacing = instrument === 'ukulele' ? 28 : 22;
  const fretSpacing = 30;
  const topMargin = 38;
  const leftMargin = 30;
  const rightMargin = 15;
  const bottomMargin = 28;
  const gridW = (numStrings - 1) * stringSpacing;
  const gridH = numFrets * fretSpacing;
  const svgW = leftMargin + gridW + rightMargin;
  const svgH = topMargin + gridH + bottomMargin;

  const rootSemi = chordSemis[0] % 12;

  let svg = `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">`;

  // Nut (thick bar at top if starting from fret 1)
  if (startFret === 1) {
    svg += `<rect x="${leftMargin - 1}" y="${topMargin - 2}" width="${gridW + 2}" height="4" rx="1" fill="#3a3530"/>`;
  }

  // Fret number indicator if not starting from fret 1
  if (startFret > 1) {
    svg += `<text x="${leftMargin - 10}" y="${topMargin + fretSpacing / 2 + 4}" text-anchor="end" font-size="10" font-weight="700" fill="#9a958e">${startFret}fr</text>`;
  }

  // Fret lines
  for (let f = 0; f <= numFrets; f++) {
    const y = topMargin + f * fretSpacing;
    svg += `<line x1="${leftMargin}" y1="${y}" x2="${leftMargin + gridW}" y2="${y}" stroke="#d0cbc2" stroke-width="${f === 0 ? 1.5 : 1}"/>`;
  }

  // String lines
  for (let s = 0; s < numStrings; s++) {
    const x = leftMargin + s * stringSpacing;
    svg += `<line x1="${x}" y1="${topMargin}" x2="${x}" y2="${topMargin + gridH}" stroke="#b0aaa2" stroke-width="${instrument === 'guitar' ? Math.max(1, 2.2 - s * 0.25) : 1.5}"/>`;
  }

  // String labels at bottom
  for (let s = 0; s < numStrings; s++) {
    const x = leftMargin + s * stringSpacing;
    svg += `<text x="${x}" y="${topMargin + gridH + 18}" text-anchor="middle" font-size="9" font-weight="600" fill="#b0aaa2">${labels[s]}</text>`;
  }

  // Finger dots and mute/open markers
  for (let s = 0; s < numStrings; s++) {
    const x = leftMargin + s * stringSpacing;
    const v = voicing[s];

    if (!v) {
      // Muted string — X marker
      svg += `<text x="${x}" y="${topMargin - 10}" text-anchor="middle" font-size="12" font-weight="700" fill="#c0b8b0">✕</text>`;
    } else if (v.fret === 0) {
      // Open string — O marker
      svg += `<circle cx="${x}" cy="${topMargin - 14}" r="5" fill="none" stroke="${v.isRoot ? '#6a50a0' : '#8a8580'}" stroke-width="1.8"/>`;
    } else {
      // Fretted note — filled dot
      const fretIdx = v.fret - startFret;
      const y = topMargin + fretIdx * fretSpacing + fretSpacing / 2;
      const isRoot = v.semi === rootSemi;
      const r = instrument === 'ukulele' ? 9 : 8;
      svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${isRoot ? '#6a50a0' : '#8a8580'}"/>`;
      // Note name inside dot
      const nName = noteName(v.semi, rootIdx);
      svg += `<text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="7.5" font-weight="700" fill="#fff">${nName}</text>`;
    }
  }

  svg += '</svg>';
  container.innerHTML = `<div class="chord-diagram-wrap">${svg}</div>`;
}

// Score a voicing's playability (lower = easier)
// Returns { score: 1-4, label, tip, cssClass }
export function rateVoicingDifficulty(chordSemis, instrument) {
  const voicing = findVoicing(chordSemis, instrument);
  const tuning = TUNINGS[instrument];
  const numStrings = tuning.length;

  let score = 0;
  let tips = [];

  // --- Fret span ---
  const frettedPositions = voicing.filter(v => v && v.fret > 0).map(v => v.fret);
  const span = frettedPositions.length > 1
    ? Math.max(...frettedPositions) - Math.min(...frettedPositions)
    : 0;

  if (span >= 4) { score += 3; tips.push('wide stretch'); }
  else if (span === 3) { score += 2; tips.push('3-fret stretch'); }
  else if (span === 2) { score += 1; }

  // --- Open strings (easier) ---
  const openCount = voicing.filter(v => v && v.fret === 0).length;
  if (openCount >= 3) score -= 2;
  else if (openCount >= 1) score -= 1;
  if (openCount >= 2) tips.push('uses open strings');

  // --- Muted strings ---
  const mutedCount = voicing.filter(v => !v).length;
  if (mutedCount >= 2) { score += 2; tips.push('mute ' + mutedCount + ' strings'); }
  else if (mutedCount === 1) { score += 1; }

  // Interior mutes (muted string between played strings — hardest to control)
  let hasInteriorMute = false;
  let firstPlayed = -1, lastPlayed = -1;
  for (let s = 0; s < numStrings; s++) {
    if (voicing[s]) {
      if (firstPlayed < 0) firstPlayed = s;
      lastPlayed = s;
    }
  }
  if (firstPlayed >= 0) {
    for (let s = firstPlayed; s <= lastPlayed; s++) {
      if (!voicing[s]) { hasInteriorMute = true; break; }
    }
  }
  if (hasInteriorMute) { score += 2; tips.push('interior mute needed'); }

  // --- Barre detection ---
  // If multiple strings share the same fret at the lowest fretted position, likely a barre
  if (frettedPositions.length >= 2) {
    const minFret = Math.min(...frettedPositions);
    const atMinFret = frettedPositions.filter(f => f === minFret).length;
    if (atMinFret >= 2 && minFret > 0) {
      score += 1;
      if (atMinFret >= 4) { score += 1; tips.push('barre chord'); }
      else tips.push('partial barre');
    }
  }

  // --- High fret position (harder to reach) ---
  const maxFret = frettedPositions.length ? Math.max(...frettedPositions) : 0;
  if (maxFret > 7) { score += 1; tips.push('high up the neck'); }

  // --- Finger count ---
  const fingersNeeded = frettedPositions.length;
  if (fingersNeeded >= 4) { score += 1; }
  if (fingersNeeded <= 2 && openCount >= 1) { score -= 1; }

  // Clamp to 1-4
  score = Math.max(1, Math.min(4, Math.ceil(score / 2) + 1));

  // If all open + nothing tricky, force easy
  if (frettedPositions.length === 0) score = 1;
  if (openCount >= 3 && span <= 1 && !hasInteriorMute && mutedCount === 0) score = 1;

  const levels = [
    { label: 'Easy', cssClass: 'diff-easy' },
    { label: 'Medium', cssClass: 'diff-medium' },
    { label: 'Hard', cssClass: 'diff-hard' },
    { label: 'Very Hard', cssClass: 'diff-very-hard' },
  ];

  const level = levels[Math.min(score - 1, 3)];
  const tip = tips.length > 0 ? tips.slice(0, 2).join(', ') : (score <= 1 ? 'beginner friendly' : '');

  return { score, label: level.label, cssClass: level.cssClass, tip };
}
