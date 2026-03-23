/**
 * audio-capture.js
 *
 * Records a PCM buffer from the microphone on demand, triggered by an onset
 * detection event. Skips the first SKIP_MS (pick noise), then records
 * CAPTURE_MS of clean audio.
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
    this.SKIP_MS    = 50;    // skip broadband pick noise at onset
    this.CAPTURE_MS = 1200;  // record 1.2s of bloom + early sustain

    // ── State ─────────────────────────────────────────────────
    this._processor   = null;
    this._chunks      = [];   // Float32Array segments collected during capture
    this._capturing   = false;
    this._complete    = false;
    this._buffer      = null; // final concatenated Float32Array
    this._skipTimer   = null;
    this._stopTimer   = null;
    this._onComplete  = null; // callback fired when capture finishes
  }

  /**
   * Begin capturing. Skips the first SKIP_MS after onset, then accumulates
   * PCM samples for CAPTURE_MS.
   *
   * @param {function} [onComplete] - Called with no args when capture is done.
   */
  startCapture(onComplete) {
    if (this._capturing) return;

    this._onComplete = onComplete || null;
    this._chunks = [];
    this._capturing = false;  // not yet — waiting out the skip window
    this._complete  = false;
    this._buffer    = null;

    const ctx = this._micManager.getContext();
    const source = this._micManager.getSource();

    // Create ScriptProcessorNode (bufferSize 4096, 1 input channel, 1 output)
    this._processor = ctx.createScriptProcessor(4096, 1, 1);

    this._processor.onaudioprocess = (e) => {
      if (!this._capturing) return;
      // Copy the input channel data — getChannelData returns a live view,
      // so we must slice to detach it from the buffer before the event ends.
      const data = e.inputBuffer.getChannelData(0);
      this._chunks.push(new Float32Array(data));
    };

    // Connect: source → processor → (silent output, no feedback)
    source.connect(this._processor);
    this._processor.connect(ctx.destination);

    // Wait out the pick-noise window, then start accumulating
    this._skipTimer = setTimeout(() => {
      this._capturing = true;

      // Stop after CAPTURE_MS of real audio
      this._stopTimer = setTimeout(() => {
        this._finishCapture();
      }, this.CAPTURE_MS);
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
      durationMs: this.CAPTURE_MS,
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
    if (this._stopTimer != null) {
      clearTimeout(this._stopTimer);
      this._stopTimer = null;
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
