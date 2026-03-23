/**
 * pitch-analyser.js
 *
 * Offline multi-frame pitch detection on a captured audio buffer.
 * Uses TWO complementary methods per frame:
 *
 *   1. YIN  — finds the single strongest fundamental (monophonic, high precision)
 *   2. FFT peak detection — finds multiple simultaneous pitches (polyphonic)
 *
 * Both methods contribute to a shared pitch-class hit map. This combination
 * is critical: YIN alone can only report one note per frame (useless for
 * chords), while FFT peaks alone can confuse harmonics for fundamentals.
 * Together they reliably detect 3-6 note chords from a single strum.
 */

import { yin } from './yin.js';

export class PitchAnalyser {
  /** @param {number} sampleRate */
  constructor(sampleRate) {
    this.sampleRate = sampleRate;

    // ── Config ────────────────────────────────────────────────
    this.FFT_SIZE       = 8192;  // large window → fine Hz resolution offline
    this.HOP_SIZE       = 2048;  // 75% overlap between frames
    this.YIN_THRESHOLD  = 0.15;  // YIN d'(tau) cutoff
    this.MIN_FREQUENCY  = 75;    // ~guitar low E with headroom
    this.MAX_FREQUENCY  = 1500;  // above highest guitar/uke fundamental
    this.YIN_MIN_CONF   = 0.60;  // YIN confidence cutoff (lower for chords — polyphonic interference reduces YIN certainty)
    this.FFT_PEAK_DB    = 20;    // dB above noise floor to count as a spectral peak
    this.MIN_HIT_RATIO  = 0.12;  // note must appear in 12%+ of frames to count
  }

  /**
   * Analyse a captured audio buffer and return detected pitch classes.
   *
   * @param {{ samples: Float32Array, sampleRate: number }} buffer
   * @returns {{
   *   pitchClasses: Map<number, { hits: number, avgConfidence: number, avgFrequency: number }>,
   *   dominantFrequency: number|null,
   *   dominantNote: { noteName: string, octave: number, cents: number }|null,
   *   isSingleNote: boolean
   * }}
   */
  analyse(buffer) {
    const { samples } = buffer;

    // ── Step 1: Slice into overlapping frames ─────────────────
    const frameCount = Math.max(
      1,
      Math.floor((samples.length - this.FFT_SIZE) / this.HOP_SIZE) + 1
    );

    // Per pitch class: total hits and confidence sums
    const hitCounts = new Array(12).fill(0);
    const confSums  = new Array(12).fill(0);
    const freqSums  = new Array(12).fill(0);

    let totalFrames = 0;

    for (let f = 0; f < frameCount; f++) {
      const start = f * this.HOP_SIZE;
      const end   = start + this.FFT_SIZE;
      if (end > samples.length) break;

      const frame    = samples.slice(start, end);
      const windowed = hannWindow(frame);

      totalFrames++;

      // ── Method 1: YIN (dominant pitch) ────────────────────
      const yinResult = yin(windowed, this.sampleRate, this.YIN_THRESHOLD);
      if (yinResult &&
          yinResult.frequency >= this.MIN_FREQUENCY &&
          yinResult.frequency <= this.MAX_FREQUENCY &&
          yinResult.confidence >= this.YIN_MIN_CONF) {
        const midi = Math.round(12 * Math.log2(yinResult.frequency / 440) + 69);
        const pc   = ((midi % 12) + 12) % 12;
        hitCounts[pc]++;
        confSums[pc]  += yinResult.confidence;
        freqSums[pc]  += yinResult.frequency;
      }

      // ── Method 2: FFT peak detection (polyphonic) ─────────
      const peaks = fftPeaks(
        windowed, this.sampleRate, this.FFT_SIZE,
        this.MIN_FREQUENCY, this.MAX_FREQUENCY, this.FFT_PEAK_DB
      );

      for (const peak of peaks) {
        const pc = ((peak.midi % 12) + 12) % 12;
        // Avoid double-counting if YIN already found this same pitch class this frame
        // by giving FFT hits slightly lower confidence weight
        hitCounts[pc]++;
        confSums[pc]  += 0.7; // fixed moderate confidence for FFT peaks
        freqSums[pc]  += peak.frequency;
      }
    }

    // ── Step 2: Filter by hit ratio ──────────────────────────
    // Total hit opportunities per frame = 1 (YIN) + N (FFT peaks), but we
    // normalise against totalFrames since that's the frame count.
    const minHits = Math.max(1, Math.ceil(totalFrames * this.MIN_HIT_RATIO));

    const pitchClasses = new Map();

    for (let pc = 0; pc < 12; pc++) {
      if (hitCounts[pc] >= minHits) {
        pitchClasses.set(pc, {
          hits:          hitCounts[pc],
          avgConfidence: confSums[pc] / hitCounts[pc],
          avgFrequency:  freqSums[pc] / hitCounts[pc],
        });
      }
    }

    // ── Step 3: Harmonic verification ────────────────────────
    // Remove notes that only appear as harmonics of stronger notes.
    const toRemove = [];
    for (const [pc, data] of pitchClasses) {
      for (const [otherPc, otherData] of pitchClasses) {
        if (pc === otherPc) continue;
        const ratio = data.avgFrequency / otherData.avgFrequency;
        // Is this note ~2× another note's frequency AND much weaker?
        if (ratio > 1.85 && ratio < 2.15 && data.hits < otherData.hits * 0.5) {
          toRemove.push(pc);
          break;
        }
      }
    }
    for (const pc of toRemove) pitchClasses.delete(pc);

    // ── Tuner data ───────────────────────────────────────────
    let dominantPc   = -1;
    let dominantHits = 0;
    for (const [pc, data] of pitchClasses) {
      if (data.hits > dominantHits) {
        dominantHits = data.hits;
        dominantPc   = pc;
      }
    }

    let dominantFrequency = null;
    let dominantNote      = null;
    if (dominantPc !== -1) {
      dominantFrequency = pitchClasses.get(dominantPc).avgFrequency;
      dominantNote      = getNearestNote(dominantFrequency);
    }

    const isSingleNote = pitchClasses.size === 1;

    return { pitchClasses, dominantFrequency, dominantNote, isSingleNote };
  }
}

// ── FFT peak detection ────────────────────────────────────────

/**
 * Compute magnitude spectrum via radix-2 FFT, then find local peaks
 * above the noise floor. Returns multiple detected pitches per frame.
 *
 * @param {Float32Array} windowed  - Hann-windowed time-domain samples
 * @param {number} sampleRate
 * @param {number} fftSize
 * @param {number} minFreq
 * @param {number} maxFreq
 * @param {number} peakDbAboveFloor
 * @returns {Array<{ frequency: number, midi: number, magnitude: number }>}
 */
function fftPeaks(windowed, sampleRate, fftSize, minFreq, maxFreq, peakDbAboveFloor) {
  // Compute magnitude spectrum
  const { re, im } = fft(windowed);
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;

  // Convert to dB magnitude for the bins we care about
  const minBin = Math.max(1, Math.floor(minFreq / hzPerBin));
  const maxBin = Math.min(binCount - 2, Math.floor(maxFreq / hzPerBin));

  const mags = new Float32Array(binCount);
  for (let i = minBin; i <= maxBin; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    mags[i] = 20 * Math.log10(mag + 1e-10); // dB
  }

  // Find noise floor (median of magnitudes in range)
  const sorted = [];
  for (let i = minBin; i <= maxBin; i++) sorted.push(mags[i]);
  sorted.sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.5)];
  const threshold  = noiseFloor + peakDbAboveFloor;

  // Find local maxima above threshold
  const peaks = [];
  const seenPitchClasses = new Set();

  for (let i = minBin + 1; i < maxBin; i++) {
    if (mags[i] > mags[i - 1] && mags[i] > mags[i + 1] && mags[i] > threshold) {
      // Parabolic interpolation for sub-bin accuracy
      const a = mags[i - 1];
      const b = mags[i];
      const c = mags[i + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c));
      const freq  = (i + (isFinite(shift) ? shift : 0)) * hzPerBin;

      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      if (midi < 28 || midi > 96) continue;

      // Deduplicate: only one peak per pitch class per frame
      const pc = ((midi % 12) + 12) % 12;
      if (seenPitchClasses.has(pc)) continue;
      seenPitchClasses.add(pc);

      peaks.push({ frequency: freq, midi, magnitude: mags[i] });
    }
  }

  return peaks;
}

// ── Radix-2 FFT (in-place, iterative) ─────────────────────────

/**
 * Compute the FFT of a real-valued signal.
 * Returns complex arrays { re, im } of length N.
 * Input length MUST be a power of 2.
 */
function fft(signal) {
  const N = signal.length;
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  // Bit-reversal permutation
  for (let i = 0; i < N; i++) {
    re[bitReverse(i, N)] = signal[i];
  }

  // Cooley-Tukey iterative FFT
  for (let size = 2; size <= N; size *= 2) {
    const half  = size / 2;
    const angle = -2 * Math.PI / size;

    for (let i = 0; i < N; i += size) {
      for (let j = 0; j < half; j++) {
        const wr = Math.cos(angle * j);
        const wi = Math.sin(angle * j);

        const evenIdx = i + j;
        const oddIdx  = i + j + half;

        const tRe = wr * re[oddIdx] - wi * im[oddIdx];
        const tIm = wr * im[oddIdx] + wi * re[oddIdx];

        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;
      }
    }
  }

  return { re, im };
}

/**
 * Reverse the bottom log2(N) bits of an integer.
 */
function bitReverse(x, N) {
  const bits = Math.log2(N);
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}

// ── Hann window ───────────────────────────────────────────────

function hannWindow(buffer) {
  const N = buffer.length;
  const windowed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    windowed[i] = buffer[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  }
  return windowed;
}

// ── Tuner helpers ─────────────────────────────────────────────

const NOTE_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function getNearestNote(frequency) {
  const midiFloat   = 12 * Math.log2(frequency / 440) + 69;
  const midi        = Math.round(midiFloat);
  const noteName    = NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
  const octave      = Math.floor(midi / 12) - 1;
  const perfectFreq = 440 * Math.pow(2, (midi - 69) / 12);
  const cents       = Math.round(1200 * Math.log2(frequency / perfectFreq));

  return { noteName, octave, midi, cents, perfectFreq };
}
