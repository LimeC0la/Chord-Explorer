/**
 * onset-detector.js
 *
 * Monitors microphone amplitude via an AnalyserNode and fires onset events
 * when a strum is detected — specifically when RMS crosses ONSET_THRESHOLD
 * upward after a minimum gap since the last onset.
 *
 * Called every rAF frame from the listening loop. Cheap: one time-domain
 * read + RMS calc, no allocations.
 */

export class OnsetDetector {
  /**
   * @param {AnalyserNode} analyser - From MicManager.getAnalyser()
   */
  constructor(analyser) {
    this.analyser = analyser;
    this._buffer = new Float32Array(analyser.fftSize);

    // ── Config ────────────────────────────────────────────────
    this.RMS_SILENCE_THRESHOLD = 0.01;  // below this = room noise, don't analyse
    this.RMS_ONSET_THRESHOLD   = 0.04;  // above this = something was played
    this.MIN_ONSET_GAP_MS      = 2000;  // prevent re-triggers during sustain/decay

    this._lastOnsetTime = -Infinity;
    this._prevRms = 0;
  }

  /**
   * Read the current amplitude and decide if a strum onset just occurred.
   * Must be called every rAF frame while in LISTENING state.
   *
   * @returns {{ onset: boolean, rms: number, isSilent: boolean }}
   */
  check() {
    this.analyser.getFloatTimeDomainData(this._buffer);
    const rms = computeRMS(this._buffer);

    const now = performance.now();
    const gapOk = (now - this._lastOnsetTime) >= this.MIN_ONSET_GAP_MS;

    // Onset = upward crossing of threshold AND enough gap since last onset
    const onset = (
      this._prevRms < this.RMS_ONSET_THRESHOLD &&
      rms >= this.RMS_ONSET_THRESHOLD &&
      gapOk
    );

    if (onset) {
      this._lastOnsetTime = now;
    }

    this._prevRms = rms;

    return {
      onset,
      rms,
      isSilent: rms < this.RMS_SILENCE_THRESHOLD,
    };
  }

  /** Reset onset timing — call when starting a fresh listening session. */
  reset() {
    this._lastOnsetTime = -Infinity;
    this._prevRms = 0;
  }
}

/**
 * Compute root-mean-square amplitude of a Float32Array.
 * @param {Float32Array} buffer
 * @returns {number}
 */
function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}
