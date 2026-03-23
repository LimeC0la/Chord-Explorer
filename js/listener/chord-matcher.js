/**
 * chord-matcher.js
 *
 * Takes a Map of detected pitch classes (from PitchAnalyser) and scores
 * every root × chord-type combination to find the best matches.
 *
 * Input:  Map<pitchClass (0-11), { hits, avgConfidence }>
 * Output: { candidates: [...top 3], detectedNotes: number[] } | null
 *
 * Scoring per candidate chord:
 *   +2 * avgConfidence  for each expected note present (hit)
 *   -1.5               for each expected note absent   (miss)
 *   -0.5               for each detected note not in chord (extra — likely harmonic)
 *   +1                 bonus if root pitch class has highest hit count
 *
 * Minimum score thresholds:
 *   Triads (3 notes): >= 3.0
 *   7th chords (4+):  >= 4.0
 */

import { ROOTS, CHORD_TYPES, chordSymbol } from '../music-theory.js';

// Pre-compute all root × type candidates once at module load
const ALL_CANDIDATES = buildCandidates();

function buildCandidates() {
  const out = [];
  for (let r = 0; r < ROOTS.length; r++) {
    for (let t = 0; t < CHORD_TYPES.length; t++) {
      const rootSemi   = ROOTS[r].semi;
      const intervals  = CHORD_TYPES[t].intervals;
      const pitchClasses = new Set(intervals.map(s => (rootSemi + s) % 12));
      out.push({ rootIdx: r, typeIdx: t, pitchClasses });
    }
  }
  return out;
}

export class ChordMatcher {
  /**
   * Find the top matching chords for a set of detected pitch classes.
   *
   * @param {Map<number, { hits: number, avgConfidence: number }>} detectedNotes
   * @returns {{
   *   candidates: Array<{ rootIdx, typeIdx, symbol, score, confidence }>,
   *   detectedNotes: number[]
   * } | null}
   */
  match(detectedNotes) {
    if (detectedNotes.size < 2) return null;

    // Find which pitch class has the highest hit count (likely the bass/root)
    let dominantPc   = -1;
    let dominantHits = 0;
    for (const [pc, data] of detectedNotes) {
      if (data.hits > dominantHits) {
        dominantHits = data.hits;
        dominantPc   = pc;
      }
    }

    const results = [];

    for (const cand of ALL_CANDIDATES) {
      let score = 0;
      const numChordNotes = cand.pitchClasses.size;

      // Hits and misses
      for (const pc of cand.pitchClasses) {
        if (detectedNotes.has(pc)) {
          score += 2 * detectedNotes.get(pc).avgConfidence;
        } else {
          score -= 1.5;
        }
      }

      // Extra notes (detected but not in chord) — penalise lightly
      for (const [pc] of detectedNotes) {
        if (!cand.pitchClasses.has(pc)) {
          score -= 0.5;
        }
      }

      // Root bonus — if the pitch class with most hits matches the chord root
      const rootPc = ROOTS[cand.rootIdx].semi;
      if (dominantPc !== -1 && rootPc === dominantPc) {
        score += 1;
      }

      // Minimum score threshold per chord size
      const minScore = numChordNotes >= 4 ? 4.0 : 3.0;
      if (score < minScore) continue;

      // Normalise score to 0-99% confidence
      const maxPossible = (numChordNotes * 2) + 1; // all hits at conf 1.0 + root bonus
      const confidence  = Math.min(99, Math.round((score / maxPossible) * 100));

      results.push({
        rootIdx:    cand.rootIdx,
        typeIdx:    cand.typeIdx,
        symbol:     chordSymbol(cand.rootIdx, cand.typeIdx),
        score,
        confidence,
      });
    }

    if (results.length === 0) return null;

    // Sort by score descending, take top 3
    results.sort((a, b) => b.score - a.score);
    const top3 = results.slice(0, 3);

    return {
      candidates:    top3,
      detectedNotes: [...detectedNotes.keys()].sort((a, b) => a - b),
    };
  }
}
