/**
 * NoteAccumulator
 *
 * Collects detected notes over a rolling time window and determines which
 * pitch classes are currently present. Filters out transient noise and
 * brief harmonics by requiring a minimum number of detections.
 */
export class NoteAccumulator {
  /**
   * @param {number} windowMs  - Rolling window duration in milliseconds
   * @param {number} minHits   - Minimum detections for a note to count as active
   */
  constructor(windowMs = 600, minHits = 3) {
    this.windowMs = windowMs;
    this.minHits = minHits;
    this.detections = []; // { midi, pitchClass, confidence, timestamp }
  }

  /**
   * Record a detected note.
   * @param {number} midi       - MIDI note number (0-127)
   * @param {number} confidence - Detection confidence (0-1)
   * @param {number} timestamp  - Time of detection (ms, e.g. performance.now())
   */
  addDetection(midi, confidence, timestamp) {
    const pitchClass = midi % 12;
    this.detections.push({ midi, pitchClass, confidence, timestamp });

    // Prune detections that have fallen outside the rolling window
    const cutoff = timestamp - this.windowMs;
    this.detections = this.detections.filter(d => d.timestamp >= cutoff);
  }

  /**
   * Get the set of pitch classes currently meeting the minimum-hit threshold.
   * @returns {Set<number>} Pitch classes (0-11) with enough recent detections
   */
  getActiveNotes() {
    const now = performance.now();
    const cutoff = now - this.windowMs;

    // Prune stale detections
    this.detections = this.detections.filter(d => d.timestamp >= cutoff);

    // Count hits per pitch class
    const counts = new Array(12).fill(0);
    for (const d of this.detections) {
      counts[d.pitchClass]++;
    }

    // Return pitch classes that meet the threshold
    const active = new Set();
    for (let pc = 0; pc < 12; pc++) {
      if (counts[pc] >= this.minHits) {
        active.add(pc);
      }
    }
    return active;
  }

  /** Clear all accumulated detections. */
  reset() {
    this.detections = [];
  }
}
