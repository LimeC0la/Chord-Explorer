/**
 * audio-capture.js
 *
 * Records a PCM buffer from the microphone on demand, triggered by an onset
 * detection event. Skips the first SKIP_MS (pick noise), then records
 * audio with adaptive duration — stops early if the signal decays below
 * threshold, or extends up to MAX_MS if the signal is still ringing.
 *
 * Uses ScriptProcessorNode rather than AudioWorklet — deprecated but
 * universally supported, including Samsung S23 Chrome. AudioWorklet requires
 * a separate file served with the correct MIME type, which complicates
 * GitHub Pages deployment.
 *
 * Depends on MicManager exposing getContext() and getSource().
 */

export class AudioCapture {
  /**
   * @param {MicManager} micManager
   */
  constructor(micManager) {
    this._micManager = micManager;

    // ── Config ────────────────────────────────────────────────
    this.SKIP_MS     = 50;    // skip broadband pick noise at onset
    this.MIN_MS      = 800;   // minimum capture (enough for a quick strum)
    this.DEFAULT_MS  = 1200;  // default capture if energy stays moderate
    this.MAX_MS      = 3000;  // absolute maximum (long sustained chord)

    // Adaptive energy thresholds
    this.SILENCE_THRESHOLD = 0.0003;  // RMS² below this = signal has decayed
    this.SILENCE_FRAMES    = 3;       // consecutive quiet frames before early stop
    this.EXTEND_THRESHOLD  = 0.002;   // RMS² above this = signal still strong, keep going

    // ── State ─────────────────────────────────────────────────
    this._processor      = null;
    this._chunks         = [];
    this._capturing      = false;
    this._complete       = false;
    this._buffer         = null;
    this._skipTimer      = null;
    this._maxTimer       = null;  // hard stop at MAX_MS
    this._onComplete     = null;
    this._captureStartMs = 0;    // performance.now() when capture begins
    this._silenceCount   = 0;    // consecutive silent frames
    this._actualDuration = 0;    // how long we actually captured
  }

  /**
   * Begin capturing. Skips the first SKIP_MS after onset, then accumulates
   * PCM samples. Duration adapts based on signal energy:
   * - Minimum MIN_MS always captured
   * - After MIN_MS, if signal decays → stop early
   * - If signal is still strong at DEFAULT_MS → extend up to MAX_MS
   * - Hard stop at MAX_MS regardless
   *
   * @param {function} [onComplete] - Called with no args when capture is done.
   */
  startCapture(onComplete) {
    if (this._capturing) return;

    this._onComplete     = onComplete || null;
    this._chunks         = [];
    this._capturing      = false;
    this._complete       = false;
    this._buffer         = null;
    this._silenceCount   = 0;
    this._actualDuration = 0;

    const ctx = this._micManager.getContext();
    const source = this._micManager.getSource();

    // Create ScriptProcessorNode (bufferSize 4096, 1 input channel, 1 output)
    this._processor = ctx.createScriptProcessor(4096, 1, 1);

    this._processor.onaudioprocess = (e) => {
      if (!this._capturing) return;

      const data = e.inputBuffer.getChannelData(0);
      this._chunks.push(new Float32Array(data));

      // Check elapsed time
      const elapsedMs = performance.now() - this._captureStartMs;

      // Always capture at least MIN_MS
      if (elapsedMs < this.MIN_MS) return;

      // Compute frame energy (RMS²)
      let energy = 0;
      for (let i = 0; i < data.length; i++) {
        energy += data[i] * data[i];
      }
      energy /= data.length;

      // Check for signal decay → early stop
      if (energy < this.SILENCE_THRESHOLD) {
        this._silenceCount++;
        if (this._silenceCount >= this.SILENCE_FRAMES) {
          this._actualDuration = elapsedMs;
          this._finishCapture();
          return;
        }
      } else {
        this._silenceCount = 0;
      }

      // Past default duration, only continue if signal is still strong
      if (elapsedMs >= this.DEFAULT_MS && energy < this.EXTEND_THRESHOLD) {
        this._actualDuration = elapsedMs;
        this._finishCapture();
        return;
      }
    };

    // Connect: source → processor → (silent output, no feedback)
    source.connect(this._processor);
    this._processor.connect(ctx.destination);

    // Wait out the pick-noise window, then start accumulating
    this._skipTimer = setTimeout(() => {
      this._capturing = true;
      this._captureStartMs = performance.now();

      // Hard stop at MAX_MS — never record longer than this
      this._maxTimer = setTimeout(() => {
        if (this._capturing) {
          this._actualDuration = this.MAX_MS;
          this._finishCapture();
        }
      }, this.MAX_MS);
    }, this.SKIP_MS);
  }

  /**
   * Cancel an in-progress capture and clean up nodes.
   */
  cancel() {
    this._clearTimers();
    this._disconnectProcessor();
    this._capturing = false;
    this._complete  = false;
    this._chunks    = [];
    this._buffer    = null;
  }

  /**
   * @returns {{ samples: Float32Array, sampleRate: number, durationMs: number } | null}
   *   Only valid after isComplete() is true.
   */
  getBuffer() {
    if (!this._complete || !this._buffer) return null;
    return {
      samples:    this._buffer,
      sampleRate: this._micManager.getSampleRate(),
      durationMs: this._actualDuration,
    };
  }

  /** @returns {boolean} */
  isCapturing() {
    return this._capturing && !this._complete;
  }

  /** @returns {boolean} */
  isComplete() {
    return this._complete;
  }

  // ── Private ────────────────────────────────────────────────

  _finishCapture() {
    this._capturing = false;
    this._complete  = true;

    this._clearTimers();

    // Concatenate all chunks into a single Float32Array
    const totalLen = this._chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of this._chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this._buffer = merged;
    this._chunks = [];

    // Compute actual duration from sample count if not set
    if (!this._actualDuration) {
      this._actualDuration = (totalLen / this._micManager.getSampleRate()) * 1000;
    }

    this._disconnectProcessor();

    if (this._onComplete) {
      this._onComplete();
    }
  }

  _clearTimers() {
    if (this._skipTimer != null) {
      clearTimeout(this._skipTimer);
      this._skipTimer = null;
    }
    if (this._maxTimer != null) {
      clearTimeout(this._maxTimer);
      this._maxTimer = null;
    }
  }

  _disconnectProcessor() {
    this._clearTimers();
    if (this._processor) {
      try { this._processor.disconnect(); } catch (_) { /* already disconnected */ }
      this._processor.onaudioprocess = null;
      this._processor = null;
    }
  }
}
