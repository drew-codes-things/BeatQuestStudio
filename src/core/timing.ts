import type { Timing } from "./model";

const SECONDS_PER_MINUTE = 60;
export const MIN_BPM = 30;
export const MAX_BPM = 400;

export function secondsPerBeat(timing: Timing): number {
  return SECONDS_PER_MINUTE / timing.bpm;
}

export function beatToSeconds(beat: number, timing: Timing): number {
  return timing.offsetSeconds + beat * secondsPerBeat(timing);
}

export function secondsToBeat(seconds: number, timing: Timing): number {
  return (seconds - timing.offsetSeconds) / secondsPerBeat(timing);
}

export function snapBeat(beat: number, divisionsPerBeat: number): number {
  if (!Number.isInteger(divisionsPerBeat) || divisionsPerBeat < 1) throw new RangeError(`divisions per beat must be a whole number of at least 1, got ${divisionsPerBeat}`);
  return Math.round(beat * divisionsPerBeat) / divisionsPerBeat;
}

export function validateBpm(bpm: number): string | null {
  if (!Number.isFinite(bpm)) return "BPM must be a number";
  if (bpm < MIN_BPM || bpm > MAX_BPM) return `BPM must be between ${MIN_BPM} and ${MAX_BPM}`;
  return null;
}

export function songLengthInBeats(durationSeconds: number, timing: Timing): number {
  return Math.max(0, secondsToBeat(durationSeconds, timing));
}
