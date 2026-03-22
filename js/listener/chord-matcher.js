/**
 * chord-matcher.js
 *
 * Takes a set of detected pitch classes and finds the best matching chord
 * from the predefined ROOTS and CHORD_TYPES arrays.
 *
 * Scoring algorithm per candidate chord:
 *   +2   for each expected note present in the input  (hit)
 *   -1   for each expected note missing from the input (miss)
 *   -0.5 for each input note not in the chord          (extra)
 *   +1   bonus if the chord root is present             (bass anchor)
 *
 * A minimum score of 3 and at least 2 distinct pitch classes are required
 * before any match is returned.
 */

import { ROOTS, CHORD_TYPES } from '../music-theory.js';

export class ChordMatcher {
  constructor() {
    // Pre-compute every root × chord-type combination so matching is a
    // simple linear scan with no allocations on the hot path.
    this.candidates = [];

    for (let r = 0; r < ROOTS.length; r++) {
      for (let t = 0; t < CHORD_TYPES.length; t++) {
        const semis = CHORD_TYPES[t].semitones;
        const rootSemi = ROOTS[r].semi;
        const pitchClasses = new Set(semis.map(s => (rootSemi + s) % 12));
        this.candidates.push({ rootIdx: r, typeIdx: t, pitchClasses });
      }
    }
  }

  /**
   * Find the best-matching chord for a set of active pitch classes.
   *
   * @param {Set<number>} activeNotes  Pitch classes currently sounding (0-11).
   * @returns {{ rootIdx: number, typeIdx: number, score: number,
   *             confidence: number, missingNotes: number[],
   *             extraNotes: number[], altMatch: object|null } | null}
   *          The best match, or null if nothing scores high enough.
   */
  match(activeNotes) {
    if (activeNotes.size < 2) return null;

    let best = null;
    let secondBest = null;
    let bestScore = -Infinity;
    let secondScore = -Infinity;

    for (const cand of this.candidates) {
      let score = 0;
      const missing = [];
      const extra = [];

      // Check each note the chord expects
      for (const pc of cand.pitchClasses) {
        if (activeNotes.has(pc)) {
          score += 2;   // hit
        } else {
          score -= 1;   // miss
          missing.push(pc);
        }
      }

      // Penalise notes the player is holding that aren't in the chord
      for (const pc of activeNotes) {
        if (!cand.pitchClasses.has(pc)) {
          score -= 0.5;
          extra.push(pc);
        }
      }

      // Bonus when the root note is present — anchors the chord identity
      const rootPc = ROOTS[cand.rootIdx].semi;
      if (activeNotes.has(rootPc)) score += 1;

      // Track the two highest-scoring candidates
      if (score > bestScore) {
        secondBest = best;
        secondScore = bestScore;
        best = { rootIdx: cand.rootIdx, typeIdx: cand.typeIdx, score, missingNotes: missing, extraNotes: extra };
        bestScore = score;
      } else if (score > secondScore) {
        secondBest = { rootIdx: cand.rootIdx, typeIdx: cand.typeIdx, score, missingNotes: missing, extraNotes: extra };
        secondScore = score;
      }
    }

    if (!best || bestScore < 3) return null;

    // Confidence mapped to a 0-4 star rating
    best.confidence = bestScore >= 8 ? 4
                    : bestScore >= 6 ? 3
                    : bestScore >= 4 ? 2
                    : 1;

    // Attach the runner-up so the UI can show "Closest alt: …"
    best.altMatch = (secondBest && secondScore >= 3) ? secondBest : null;

    return best;
  }
}
