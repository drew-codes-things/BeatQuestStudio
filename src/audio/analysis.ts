import { type AttackCurve, attackCurve, fitBeatGrid } from "./beatGrid";

export const ANALYSIS_HOP_SIZE = 512;
const HALF_BEAT_FULL_BALANCE = 0.45;
const HALF_BEAT_BASS_BALANCE = 0.25;
const LOW_BAND_CUTOFF_HZ = 150;
export const BEATS_PER_BAR = 4;
const LOCAL_MEAN_SECONDS = 0.5;
const ENERGY_COMPRESSION = 1000;
const MIN_TEMPO_BPM = 60;
const MAX_TEMPO_BPM = 240;
const TEMPO_PRIOR_CENTER_BPM = 120;
const TEMPO_PRIOR_WIDTH_OCTAVES = 0.9;
const FINE_SEARCH_FRACTION = 0.03;
const FINE_SEARCH_STEP_BPM = 0.005;
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
  driftMs: number;
}

export interface SongAnalysis {
  durationSeconds: number;
  attack: AttackCurve;
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

function frameEnergies(samples: Float32Array, hopSize: number): Float32Array {
  const frameCount = Math.floor(samples.length / hopSize);
  const energies = new Float32Array(frameCount);
  let previous = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    const start = frame * hopSize;
    for (let index = start; index < start + hopSize; index += 1) {
      const sample = samples[index]!;
      const emphasised = sample - previous;
      previous = sample;
      sum += emphasised * emphasised;
    }
    energies[frame] = Math.log1p(ENERGY_COMPRESSION * sum / hopSize);
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

export function lowPass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const smoothing = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  const filtered = new Float32Array(samples.length);
  let state = 0;
  for (let index = 0; index < samples.length; index += 1) {
    state += smoothing * (samples[index]! - state);
    filtered[index] = state;
  }
  return filtered;
}

export function onsetEnvelope(samples: Float32Array, sampleRate: number, hopSize: number = ANALYSIS_HOP_SIZE): Envelope {
  const hopSeconds = hopSize / sampleRate;
  const energies = frameEnergies(samples, hopSize);
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

function envelopeAt(envelope: Envelope, seconds: number): number {
  const frame = Math.round(seconds / envelope.hopSeconds);
  let peak = 0;
  for (let index = Math.max(0, frame - 2); index <= Math.min(envelope.values.length - 1, frame + 2); index += 1) peak = Math.max(peak, envelope.values[index]!);
  return peak;
}

export function alignToDownbeat(tempo: TempoEstimate, bassEnvelope: Envelope, durationSeconds: number): TempoEstimate {
  const period = 60 / tempo.bpm;
  const strength = new Array<number>(BEATS_PER_BAR).fill(0);
  let beat = 0;
  for (let seconds = tempo.offsetSeconds; seconds < durationSeconds; seconds += period) {
    strength[beat % BEATS_PER_BAR]! += envelopeAt(bassEnvelope, seconds);
    beat += 1;
  }
  const strongest = strength.indexOf(Math.max(...strength));
  return { ...tempo, offsetSeconds: tempo.offsetSeconds + strongest * period };
}

function halfBeatBalance(envelope: Envelope, bpm: number, offsetSeconds: number): number {
  const period = 60 / bpm;
  const durationSeconds = envelope.values.length * envelope.hopSeconds;
  let onBeat = 0;
  let halfBeat = 0;
  for (let seconds = offsetSeconds; seconds + period / 2 < durationSeconds; seconds += period) {
    onBeat += envelopeAt(envelope, seconds);
    halfBeat += envelopeAt(envelope, seconds + period / 2);
  }
  const stronger = Math.max(onBeat, halfBeat);
  return stronger > 0 ? Math.min(onBeat, halfBeat) / stronger : 0;
}

function preferFasterTempo(tempo: TempoEstimate, envelope: Envelope, bassEnvelope: Envelope): TempoEstimate {
  if (tempo.confidence === 0 || tempo.bpm * 2 > MAX_TEMPO_BPM) return tempo;
  const fullBalance = halfBeatBalance(envelope, tempo.bpm, tempo.offsetSeconds);
  const bassBalance = halfBeatBalance(bassEnvelope, tempo.bpm, tempo.offsetSeconds);
  const drumsOnEveryHalfBeat = fullBalance >= HALF_BEAT_FULL_BALANCE && bassBalance >= HALF_BEAT_BASS_BALANCE;
  return drumsOnEveryHalfBeat ? { ...tempo, bpm: tempo.bpm * 2 } : tempo;
}

export function estimateTempo(envelope: Envelope): TempoEstimate {
  const coarse = coarseTempo(envelope);
  let best = { bpm: coarse, ...phaseScore(envelope, coarse) };
  for (let bpm = coarse * (1 - FINE_SEARCH_FRACTION); bpm <= coarse * (1 + FINE_SEARCH_FRACTION); bpm += FINE_SEARCH_STEP_BPM) {
    const score = phaseScore(envelope, bpm);
    if (score.magnitude > best.magnitude) best = { bpm, ...score };
  }
  const total = envelope.values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return { bpm: Math.round(best.bpm), offsetSeconds: 0, confidence: 0, driftMs: 0 };
  const confidence = Math.min(1, best.magnitude / total);
  return { bpm: best.bpm, offsetSeconds: best.offsetSeconds, confidence, driftMs: 0 };
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

function refineTempo(tempo: TempoEstimate, curve: AttackCurve, durationSeconds: number): TempoEstimate {
  if (tempo.confidence === 0) return tempo;
  const grid = fitBeatGrid(curve, tempo.bpm, tempo.offsetSeconds, durationSeconds);
  return { ...tempo, ...grid };
}

export function analyseSong(channels: readonly Float32Array[], sampleRate: number): SongAnalysis {
  const mono = mixToMono(channels);
  const envelope = onsetEnvelope(mono, sampleRate);
  const bassEnvelope = onsetEnvelope(lowPass(mono, sampleRate, LOW_BAND_CUTOFF_HZ), sampleRate);
  const durationSeconds = mono.length / sampleRate;
  const attack = attackCurve(mono, sampleRate);
  return {
    durationSeconds,
    attack,
    tempo: alignToDownbeat(refineTempo(preferFasterTempo(estimateTempo(envelope), envelope, bassEnvelope), attack, durationSeconds), bassEnvelope, durationSeconds),
    onsets: detectOnsets(envelope),
    energy: energyCurve(mono, sampleRate),
  };
}
