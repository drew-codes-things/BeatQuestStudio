export const ATTACK_HOP_SIZE = 32;
const ATTACK_WINDOW_BLOCKS = 8;
const ATTACK_COMPRESSION = 1000;
const ATTACK_SEARCH_SECONDS = 0.07;
const OUTLIER_SECONDS = 0.025;
const FIT_ROUNDS = 3;
const MIN_FIT_BEATS = 8;
const DRIFT_SEGMENT_BEATS = 16;
const DRIFT_MIN_SECTION_BEATS = 4;
const DRIFT_SEARCH_BEATS = 0.45;
const DRIFT_PERCENTILE = 0.9;
const INTEGER_BPM_TOLERANCE = 0.05;
const INTEGER_FIT_SLACK = 1.05;
const INTEGER_FIT_ALLOWANCE_SECONDS = 0.0005;

export interface AttackCurve {
  rise: Float32Array;
  hopSeconds: number;
}

export interface BeatGrid {
  bpm: number;
  offsetSeconds: number;
  driftMs: number;
}

interface BeatAttack {
  index: number;
  seconds: number;
  weight: number;
}

interface LineFit {
  intercept: number;
  slope: number;
}

export function attackCurve(samples: Float32Array, sampleRate: number): AttackCurve {
  const blockCount = Math.floor(samples.length / ATTACK_HOP_SIZE);
  const blockEnergy = new Float32Array(blockCount);
  for (let block = 0; block < blockCount; block += 1) {
    let sum = 0;
    for (let index = block * ATTACK_HOP_SIZE; index < (block + 1) * ATTACK_HOP_SIZE; index += 1) sum += samples[index]! * samples[index]!;
    blockEnergy[block] = sum / ATTACK_HOP_SIZE;
  }
  const rise = new Float32Array(blockCount);
  let windowSum = 0;
  let previousLevel = 0;
  for (let block = 0; block < blockCount; block += 1) {
    windowSum += blockEnergy[block]!;
    if (block >= ATTACK_WINDOW_BLOCKS) windowSum -= blockEnergy[block - ATTACK_WINDOW_BLOCKS]!;
    const level = Math.log1p((ATTACK_COMPRESSION * Math.max(0, windowSum)) / ATTACK_WINDOW_BLOCKS);
    rise[block] = Math.max(0, level - previousLevel);
    previousLevel = level;
  }
  return { rise, hopSeconds: ATTACK_HOP_SIZE / sampleRate };
}

function attackTime(curve: AttackCurve, block: number): number {
  return (block + 0.5) * curve.hopSeconds;
}

function findAttacks(curve: AttackCurve, period: number, offsetSeconds: number, durationSeconds: number, searchSeconds: number): BeatAttack[] {
  const attacks: BeatAttack[] = [];
  const searchBlocks = Math.round(searchSeconds / curve.hopSeconds);
  for (let index = 0; offsetSeconds + index * period < durationSeconds; index += 1) {
    const centre = Math.round((offsetSeconds + index * period) / curve.hopSeconds);
    let bestBlock = -1;
    let bestRise = 0;
    for (let block = Math.max(1, centre - searchBlocks); block <= Math.min(curve.rise.length - 1, centre + searchBlocks); block += 1) {
      if (curve.rise[block]! > bestRise) {
        bestRise = curve.rise[block]!;
        bestBlock = block;
      }
    }
    if (bestBlock >= 0) attacks.push({ index, seconds: attackTime(curve, bestBlock), weight: bestRise });
  }
  return attacks;
}

function weightedLineFit(attacks: readonly BeatAttack[]): LineFit {
  let weightSum = 0;
  let xMean = 0;
  let yMean = 0;
  for (const attack of attacks) {
    weightSum += attack.weight;
    xMean += attack.weight * attack.index;
    yMean += attack.weight * attack.seconds;
  }
  xMean /= weightSum;
  yMean /= weightSum;
  let covariance = 0;
  let variance = 0;
  for (const attack of attacks) {
    covariance += attack.weight * (attack.index - xMean) * (attack.seconds - yMean);
    variance += attack.weight * (attack.index - xMean) ** 2;
  }
  const slope = covariance / variance;
  return { intercept: yMean - slope * xMean, slope };
}

function residual(attack: BeatAttack, fit: LineFit): number {
  return attack.seconds - (fit.intercept + fit.slope * attack.index);
}

function weightedRms(attacks: readonly BeatAttack[], fit: LineFit): number {
  let total = 0;
  let weightSum = 0;
  for (const attack of attacks) {
    total += attack.weight * residual(attack, fit) ** 2;
    weightSum += attack.weight;
  }
  return Math.sqrt(total / weightSum);
}

function fitWithSlope(attacks: readonly BeatAttack[], slope: number): LineFit {
  let weightSum = 0;
  let interceptSum = 0;
  for (const attack of attacks) {
    weightSum += attack.weight;
    interceptSum += attack.weight * (attack.seconds - slope * attack.index);
  }
  return { intercept: interceptSum / weightSum, slope };
}

function preferWholeBpm(attacks: readonly BeatAttack[], fit: LineFit): LineFit {
  const bpm = 60 / fit.slope;
  const whole = Math.round(bpm);
  if (Math.abs(whole - bpm) > INTEGER_BPM_TOLERANCE) return fit;
  const wholeFit = fitWithSlope(attacks, 60 / whole);
  const acceptable = weightedRms(attacks, fit) * INTEGER_FIT_SLACK + INTEGER_FIT_ALLOWANCE_SECONDS;
  return weightedRms(attacks, wholeFit) <= acceptable ? wholeFit : fit;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function driftMs(curve: AttackCurve, fit: LineFit, durationSeconds: number): number {
  const wideAttacks = findAttacks(curve, fit.slope, fit.intercept, durationSeconds, fit.slope * DRIFT_SEARCH_BEATS);
  const sections = new Map<number, number[]>();
  for (const attack of wideAttacks) {
    const section = Math.floor(attack.index / DRIFT_SEGMENT_BEATS);
    const residuals = sections.get(section) ?? [];
    residuals.push(residual(attack, fit));
    sections.set(section, residuals);
  }
  const deviations = [...sections.values()]
    .filter((residuals) => residuals.length >= DRIFT_MIN_SECTION_BEATS)
    .map((residuals) => Math.abs(median(residuals)))
    .sort((left, right) => left - right);
  if (deviations.length === 0) return 0;
  const percentile = deviations[Math.min(deviations.length - 1, Math.floor(deviations.length * DRIFT_PERCENTILE))]!;
  return Math.round(percentile * 10000) / 10;
}

export function measureGridDriftMs(curve: AttackCurve, bpm: number, offsetSeconds: number, durationSeconds: number): number {
  if (!(bpm > 0)) return 0;
  return driftMs(curve, { intercept: offsetSeconds, slope: 60 / bpm }, durationSeconds);
}

export function fitBeatGrid(curve: AttackCurve, bpm: number, offsetSeconds: number, durationSeconds: number): BeatGrid {
  const attacks = findAttacks(curve, 60 / bpm, offsetSeconds, durationSeconds, ATTACK_SEARCH_SECONDS);
  if (attacks.length < MIN_FIT_BEATS) return { bpm, offsetSeconds, driftMs: 0 };
  let fit: LineFit = { intercept: offsetSeconds, slope: 60 / bpm };
  let kept = attacks.filter((attack) => Math.abs(residual(attack, fit)) <= ATTACK_SEARCH_SECONDS);
  for (let round = 0; round < FIT_ROUNDS && kept.length >= MIN_FIT_BEATS; round += 1) {
    fit = weightedLineFit(kept);
    const current = fit;
    kept = attacks.filter((attack) => Math.abs(residual(attack, current)) <= OUTLIER_SECONDS);
  }
  if (kept.length >= MIN_FIT_BEATS) fit = preferWholeBpm(kept, fit);
  const period = fit.slope;
  return {
    bpm: Math.round((60 / period) * 1000) / 1000,
    offsetSeconds: ((fit.intercept % period) + period) % period,
    driftMs: driftMs(curve, fit, durationSeconds),
  };
}
