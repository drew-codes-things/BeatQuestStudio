export const ANALYSIS_HOP_SIZE = 512;
const LOCAL_MEAN_SECONDS = 0.5;
const ENERGY_COMPRESSION = 1000;
const MIN_TEMPO_BPM = 60;
const MAX_TEMPO_BPM = 240;
const TEMPO_PRIOR_CENTER_BPM = 120;
const TEMPO_PRIOR_WIDTH_OCTAVES = 0.9;
const FINE_SEARCH_FRACTION = 0.03;
const FINE_SEARCH_STEP_BPM = 0.005;
const INTEGER_BPM_TOLERANCE = 0.08;
const INTEGER_BPM_MIN_SCORE_RATIO = 0.995;
const ONSET_MIN_GAP_SECONDS = 0.06;
const ONSET_THRESHOLD_WINDOW_SECONDS = 1;
const ONSET_THRESHOLD_STD_FACTOR = 0.6;
export const ENERGY_RESOLUTION_SECONDS = 0.25;

export interface Envelope {
  values: Float32Array;
  hopSeconds: number;
}

export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
  samplesPerBucket: number;
  sampleRate: number;
}

export interface Onset {
  seconds: number;
  strength: number;
}

export interface TempoEstimate {
  bpm: number;
  offsetSeconds: number;
  confidence: number;
}

export interface SongAnalysis {
  durationSeconds: number;
  tempo: TempoEstimate;
  onsets: Onset[];
  energy: Float32Array;
}

export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const [first] = channels;
  if (!first) throw new Error("audio has no channels");
  if (channels.length === 1) return first;
  const mono = new Float32Array(first.length);
  for (const channel of channels) {
    for (let index = 0; index < mono.length; index += 1) mono[index]! += channel[index]! / channels.length;
  }
  return mono;
}

export function computePeaks(samples: Float32Array, sampleRate: number, samplesPerBucket: number = ANALYSIS_HOP_SIZE): WaveformPeaks {
  const bucketCount = Math.ceil(samples.length / samplesPerBucket);
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * samplesPerBucket;
    const end = Math.min(samples.length, start + samplesPerBucket);
    let low = 0;
    let high = 0;
    for (let index = start; index < end; index += 1) {
      const sample = samples[index]!;
      if (sample < low) low = sample;
      if (sample > high) high = sample;
    }
    min[bucket] = low;
    max[bucket] = high;
  }
  return { min, max, samplesPerBucket, sampleRate };
}

function frameEnergies(samples: Float32Array): Float32Array {
  const frameCount = Math.floor(samples.length / ANALYSIS_HOP_SIZE);
  const energies = new Float32Array(frameCount);
  let previous = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    const start = frame * ANALYSIS_HOP_SIZE;
    for (let index = start; index < start + ANALYSIS_HOP_SIZE; index += 1) {
      const sample = samples[index]!;
      const emphasised = sample - previous;
      previous = sample;
      sum += emphasised * emphasised;
    }
    energies[frame] = Math.log1p(ENERGY_COMPRESSION * sum / ANALYSIS_HOP_SIZE);
  }
  return energies;
}

function subtractLocalMean(values: Float32Array, windowFrames: number): Float32Array {
  const result = new Float32Array(values.length);
  const half = Math.max(1, Math.floor(windowFrames / 2));
  let windowSum = 0;
  let windowStart = 0;
  let windowEnd = 0;
  for (let index = 0; index < values.length; index += 1) {
    while (windowEnd < Math.min(values.length, index + half + 1)) windowSum += values[windowEnd++]!;
    while (windowStart < index - half) windowSum -= values[windowStart++]!;
    const mean = windowSum / (windowEnd - windowStart);
    result[index] = Math.max(0, values[index]! - mean);
  }
  return result;
}

export function onsetEnvelope(samples: Float32Array, sampleRate: number): Envelope {
  const hopSeconds = ANALYSIS_HOP_SIZE / sampleRate;
  const energies = frameEnergies(samples);
  const flux = new Float32Array(energies.length);
  for (let frame = 1; frame < energies.length; frame += 1) flux[frame] = Math.max(0, energies[frame]! - energies[frame - 1]!);
  return { values: subtractLocalMean(flux, Math.round(LOCAL_MEAN_SECONDS / hopSeconds)), hopSeconds };
}

function tempoPrior(bpm: number): number {
  const octaves = Math.log2(bpm / TEMPO_PRIOR_CENTER_BPM);
  return Math.exp(-0.5 * (octaves / TEMPO_PRIOR_WIDTH_OCTAVES) ** 2);
}

function autocorrelation(values: Float32Array, lag: number): number {
  let sum = 0;
  for (let index = lag; index < values.length; index += 1) sum += values[index]! * values[index - lag]!;
  return sum / (values.length - lag);
}

function coarseTempo(envelope: Envelope): number {
  const minLag = Math.max(1, Math.floor(60 / MAX_TEMPO_BPM / envelope.hopSeconds));
  const maxLag = Math.ceil(60 / MIN_TEMPO_BPM / envelope.hopSeconds);
  let bestBpm = TEMPO_PRIOR_CENTER_BPM;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const bpm = 60 / (lag * envelope.hopSeconds);
    const score = autocorrelation(envelope.values, lag) * tempoPrior(bpm);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  return bestBpm;
}

interface PhaseScore {
  magnitude: number;
  offsetSeconds: number;
}

function phaseScore(envelope: Envelope, bpm: number): PhaseScore {
  const period = 60 / bpm;
  let real = 0;
  let imaginary = 0;
  for (let frame = 0; frame < envelope.values.length; frame += 1) {
    const value = envelope.values[frame]!;
    if (value === 0) continue;
    const angle = (2 * Math.PI * frame * envelope.hopSeconds) / period;
    real += value * Math.cos(angle);
    imaginary += value * Math.sin(angle);
  }
  const phase = Math.atan2(imaginary, real);
  const offsetSeconds = (((phase / (2 * Math.PI)) * period) % period + period) % period;
  return { magnitude: Math.hypot(real, imaginary), offsetSeconds };
}

export function estimateTempo(envelope: Envelope): TempoEstimate {
  const coarse = coarseTempo(envelope);
  let best = { bpm: coarse, ...phaseScore(envelope, coarse) };
  for (let bpm = coarse * (1 - FINE_SEARCH_FRACTION); bpm <= coarse * (1 + FINE_SEARCH_FRACTION); bpm += FINE_SEARCH_STEP_BPM) {
    const score = phaseScore(envelope, bpm);
    if (score.magnitude > best.magnitude) best = { bpm, ...score };
  }
  const roundedBpm = Math.round(best.bpm);
  if (Math.abs(roundedBpm - best.bpm) <= INTEGER_BPM_TOLERANCE) {
    const integerScore = phaseScore(envelope, roundedBpm);
    if (integerScore.magnitude >= best.magnitude * INTEGER_BPM_MIN_SCORE_RATIO) best = { bpm: roundedBpm, ...integerScore };
  }
  const total = envelope.values.reduce((sum, value) => sum + value, 0);
  const confidence = total > 0 ? Math.min(1, best.magnitude / total) : 0;
  return { bpm: Math.round(best.bpm * 1000) / 1000, offsetSeconds: best.offsetSeconds, confidence };
}

export function detectOnsets(envelope: Envelope): Onset[] {
  const values = envelope.values;
  const windowFrames = Math.max(1, Math.round(ONSET_THRESHOLD_WINDOW_SECONDS / envelope.hopSeconds));
  const minGapFrames = Math.max(1, Math.round(ONSET_MIN_GAP_SECONDS / envelope.hopSeconds));
  const peak = values.reduce((max, value) => Math.max(max, value), 0);
  if (peak === 0) return [];
  const onsets: Onset[] = [];
  let lastFrame = -Infinity;
  for (let frame = 1; frame < values.length - 1; frame += 1) {
    const value = values[frame]!;
    if (value <= values[frame - 1]! || value < values[frame + 1]!) continue;
    if (value < localThreshold(values, frame, windowFrames)) continue;
    if (frame - lastFrame < minGapFrames) {
      const previous = onsets[onsets.length - 1];
      if (previous && value / peak > previous.strength) {
        previous.seconds = frame * envelope.hopSeconds;
        previous.strength = value / peak;
        lastFrame = frame;
      }
      continue;
    }
    onsets.push({ seconds: frame * envelope.hopSeconds, strength: value / peak });
    lastFrame = frame;
  }
  return onsets;
}

function localThreshold(values: Float32Array, frame: number, windowFrames: number): number {
  const start = Math.max(0, frame - windowFrames);
  const end = Math.min(values.length, frame + windowFrames);
  let sum = 0;
  let sumOfSquares = 0;
  for (let index = start; index < end; index += 1) {
    sum += values[index]!;
    sumOfSquares += values[index]! * values[index]!;
  }
  const count = end - start;
  const mean = sum / count;
  const deviation = Math.sqrt(Math.max(0, sumOfSquares / count - mean * mean));
  return mean + ONSET_THRESHOLD_STD_FACTOR * deviation;
}

export function energyCurve(samples: Float32Array, sampleRate: number): Float32Array {
  const blockSize = Math.max(1, Math.round(ENERGY_RESOLUTION_SECONDS * sampleRate));
  const blockCount = Math.ceil(samples.length / blockSize);
  const energy = new Float32Array(blockCount);
  let loudest = 0;
  for (let block = 0; block < blockCount; block += 1) {
    let sum = 0;
    const start = block * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    for (let index = start; index < end; index += 1) sum += samples[index]! * samples[index]!;
    energy[block] = Math.sqrt(sum / Math.max(1, end - start));
    loudest = Math.max(loudest, energy[block]!);
  }
  if (loudest > 0) for (let block = 0; block < blockCount; block += 1) energy[block] = energy[block]! / loudest;
  return energy;
}

export function energyAt(energy: Float32Array, seconds: number): number {
  const index = Math.floor(seconds / ENERGY_RESOLUTION_SECONDS);
  if (index < 0 || index >= energy.length) return 0;
  return energy[index]!;
}

export function analyseSong(channels: readonly Float32Array[], sampleRate: number): SongAnalysis {
  const mono = mixToMono(channels);
  const envelope = onsetEnvelope(mono, sampleRate);
  return {
    durationSeconds: mono.length / sampleRate,
    tempo: estimateTempo(envelope),
    onsets: detectOnsets(envelope),
    energy: energyCurve(mono, sampleRate),
  };
}
