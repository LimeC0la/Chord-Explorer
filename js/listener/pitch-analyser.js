/**
 * pitch-analyser.js
 *
 * Offline multi-pass pitch detection on a captured audio buffer.
 *
 * Three analysis passes at different resolutions, plus Harmonic Product
 * Spectrum (HPS) to suppress harmonics. Designed to spend 300-800ms on
 * a 1.2s capture — the strings are still ringing so this feels instant.
 *
 * Pass 1 — Large window (8192), hop 2048: fine frequency resolution for
 *          bass notes and lower chord tones. ~22 frames.
 *
 * Pass 2 — Medium window (4096), hop 1024: better time resolution, catches
 *          higher transient notes the large window smears. ~48 frames.
 *
 * Pass 3 — HPS on each large-window FFT frame: collapses harmonics down
 *          to reinforce the true fundamental. Best technique to avoid
 *          misidentifying the 2nd or 3rd harmonic as a separate note.
 *
 * All three passes contribute to a shared pitch-class hit map. The hit
 * ratio filter then removes notes that didn't appear consistently.
 */

import { yin } from './yin.js';

export class PitchAnalyser {
  /** @param {number} sampleRate */
  constructor(sampleRate) {
    this.sampleRate = sampleRate;

    // ── Config ────────────────────────────────────────────────
    this.MIN_FREQUENCY  = 75;
    this.MAX_FREQUENCY  = 1500;
    this.YIN_THRESHOLD  = 0.15;
    this.YIN_MIN_CONF   = 0.55;  // lowered — polyphonic content reduces YIN certainty
    this.FFT_PEAK_DB    = 18;    // dB above noise floor for spectral peak
    this.HPS_ORDER      = 4;     // downsample × 2, 3, 4 for harmonic product
    this.MIN_HIT_RATIO  = 0.08;  // note must appear in 8%+ of total frames across all passes

    // Pass configurations: [fftSize, hopSize]
    this.PASSES = [
      [8192, 2048],  // Pass 1: large window, fine frequency resolution
      [4096, 1024],  // Pass 2: medium window, better time resolution
    ];
  }

  /**
   * Multi-pass analysis of a captured audio buffer.
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

    // Accumulators across all passes
    const hitCounts = new Array(12).fill(0);
    const confSums  = new Array(12).fill(0);
    const freqSums  = new Array(12).fill(0);
    let totalFrames = 0;

    // ── Pass 1 & 2: YIN + FFT peaks at each resolution ──────
    for (const [fftSize, hopSize] of this.PASSES) {
      const frameCount = Math.max(
        1,
        Math.floor((samples.length - fftSize) / hopSize) + 1
      );

      for (let f = 0; f < frameCount; f++) {
        const start = f * hopSize;
        const end   = start + fftSize;
        if (end > samples.length) break;

        const frame    = samples.slice(start, end);
        const windowed = hannWindow(frame);
        totalFrames++;

        // YIN (dominant pitch)
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

        // FFT peak detection (polyphonic)
        const peaks = fftPeaks(
          windowed, this.sampleRate, fftSize,
          this.MIN_FREQUENCY, this.MAX_FREQUENCY, this.FFT_PEAK_DB
        );
        for (const peak of peaks) {
          const pc = ((peak.midi % 12) + 12) % 12;
          hitCounts[pc]++;
          confSums[pc]  += 0.70;
          freqSums[pc]  += peak.frequency;
        }
      }
    }

    // ── Pass 3: Harmonic Product Spectrum on large windows ───
    // HPS multiplies the spectrum at 1×, 2×, 3×, 4× downsampling.
    // True fundamentals get reinforced; harmonics get suppressed.
    {
      const fftSize = 8192;
      const hopSize = 4096; // 50% overlap — fewer frames, HPS is heavier
      const frameCount = Math.max(
        1,
        Math.floor((samples.length - fftSize) / hopSize) + 1
      );

      for (let f = 0; f < frameCount; f++) {
        const start = f * hopSize;
        const end   = start + fftSize;
        if (end > samples.length) break;

        const frame    = samples.slice(start, end);
        const windowed = hannWindow(frame);
        totalFrames++;

        const hpsPeaks = harmonicProductSpectrum(
          windowed, this.sampleRate, fftSize,
          this.MIN_FREQUENCY, this.MAX_FREQUENCY, this.HPS_ORDER
        );

        for (const peak of hpsPeaks) {
          const pc = ((peak.midi % 12) + 12) % 12;
          // HPS-confirmed fundamentals get a confidence boost
          hitCounts[pc] += 2;
          confSums[pc]  += 0.85 * 2;
          freqSums[pc]  += peak.frequency * 2;
        }
      }
    }

    // ── Filter by hit ratio ──────────────────────────────────
    const minHits = Math.max(2, Math.ceil(totalFrames * this.MIN_HIT_RATIO));

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

    // ── Harmonic verification (post-filter cleanup) ──────────
    // Remove notes that only appear as octave harmonics of much stronger notes.
    const toRemove = [];
    for (const [pc, data] of pitchClasses) {
      for (const [otherPc, otherData] of pitchClasses) {
        if (pc === otherPc) continue;
        const ratio = data.avgFrequency / otherData.avgFrequency;
        if (ratio > 1.85 && ratio < 2.15 && data.hits < otherData.hits * 0.4) {
          toRemove.push(pc);
          break;
        }
        // Also check 3× harmonic
        if (ratio > 2.85 && ratio < 3.15 && data.hits < otherData.hits * 0.35) {
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
 */
function fftPeaks(windowed, sampleRate, fftSize, minFreq, maxFreq, peakDbAboveFloor) {
  const { re, im } = fft(windowed);
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;

  const minBin = Math.max(1, Math.floor(minFreq / hzPerBin));
  const maxBin = Math.min(binCount - 2, Math.floor(maxFreq / hzPerBin));

  const mags = new Float32Array(binCount);
  for (let i = minBin; i <= maxBin; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    mags[i] = 20 * Math.log10(mag + 1e-10);
  }

  // Noise floor = median
  const sorted = [];
  for (let i = minBin; i <= maxBin; i++) sorted.push(mags[i]);
  sorted.sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.5)];
  const threshold  = noiseFloor + peakDbAboveFloor;

  const peaks = [];
  const seenPitchClasses = new Set();

  for (let i = minBin + 1; i < maxBin; i++) {
    if (mags[i] > mags[i - 1] && mags[i] > mags[i + 1] && mags[i] > threshold) {
      const a = mags[i - 1], b = mags[i], c = mags[i + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c));
      const freq  = (i + (isFinite(shift) ? shift : 0)) * hzPerBin;

      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      if (midi < 28 || midi > 96) continue;

      const pc = ((midi % 12) + 12) % 12;
      if (seenPitchClasses.has(pc)) continue;
      seenPitchClasses.add(pc);

      peaks.push({ frequency: freq, midi, magnitude: mags[i] });
    }
  }

  return peaks;
}

// ── Harmonic Product Spectrum ─────────────────────────────────

/**
 * HPS: multiply the magnitude spectrum at 1×, 2×, 3×, … downsampled rates.
 * Harmonics misalign under downsampling while the true fundamental reinforces.
 * Returns peaks from the product spectrum.
 */
function harmonicProductSpectrum(windowed, sampleRate, fftSize, minFreq, maxFreq, order) {
  const { re, im } = fft(windowed);
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;

  // Compute linear magnitude spectrum
  const mags = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  // HPS: product of spectrum at decimation rates 1× through order×
  const hpsLen = Math.floor(binCount / order);
  const hps    = new Float32Array(hpsLen);

  for (let i = 0; i < hpsLen; i++) {
    let product = mags[i];
    for (let h = 2; h <= order; h++) {
      product *= mags[i * h] || 1e-10;
    }
    hps[i] = product;
  }

  // Convert to log scale for peak picking
  const logHps = new Float32Array(hpsLen);
  for (let i = 0; i < hpsLen; i++) {
    logHps[i] = 20 * Math.log10(hps[i] + 1e-30);
  }

  // Noise floor
  const minBin = Math.max(1, Math.floor(minFreq / hzPerBin));
  const maxBin = Math.min(hpsLen - 2, Math.floor(maxFreq / hzPerBin));

  const sorted = [];
  for (let i = minBin; i <= maxBin; i++) sorted.push(logHps[i]);
  sorted.sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.5)];
  const threshold  = noiseFloor + 25; // HPS peaks are very sharp — use higher threshold

  const peaks = [];
  const seenPitchClasses = new Set();

  for (let i = minBin + 1; i < maxBin; i++) {
    if (logHps[i] > logHps[i - 1] && logHps[i] > logHps[i + 1] && logHps[i] > threshold) {
      const a = logHps[i - 1], b = logHps[i], c = logHps[i + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c));
      const freq  = (i + (isFinite(shift) ? shift : 0)) * hzPerBin;

      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      if (midi < 28 || midi > 96) continue;

      const pc = ((midi % 12) + 12) % 12;
      if (seenPitchClasses.has(pc)) continue;
      seenPitchClasses.add(pc);

      peaks.push({ frequency: freq, midi });
    }
  }

  return peaks;
}

// ── Radix-2 FFT (iterative, in-place) ─────────────────────────

function fft(signal) {
  const N  = signal.length;
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  // Bit-reversal permutation
  for (let i = 0; i < N; i++) {
    re[bitReverse(i, N)] = signal[i];
  }

  // Cooley-Tukey butterfly
  for (let size = 2; size <= N; size *= 2) {
    const half  = size / 2;
    const angle = -2 * Math.PI / size;

    // Pre-compute twiddle factor for this stage
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let twRe = 1, twIm = 0;

      for (let j = 0; j < half; j++) {
        const evenIdx = i + j;
        const oddIdx  = i + j + half;

        const tRe = twRe * re[oddIdx] - twIm * im[oddIdx];
        const tIm = twRe * im[oddIdx] + twIm * re[oddIdx];

        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;

        // Rotate twiddle factor
        const nextRe = twRe * wRe - twIm * wIm;
        const nextIm = twRe * wIm + twIm * wRe;
        twRe = nextRe;
        twIm = nextIm;
      }
    }
  }

  return { re, im };
}

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
