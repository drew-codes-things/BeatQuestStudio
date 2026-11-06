import { describe, expect, it } from "vitest";
import { analyseSong, computePeaks, energyAt, energyCurve, mixToMono } from "./analysis";
import { makeBandTrack, makeClickTrack } from "./testSignals";

const SAMPLE_RATE = 22050;

describe("tempo and offset", () => {
  it.each([
    { bpm: 128, offsetSeconds: 0.3 },
    { bpm: 90, offsetSeconds: 0.12 },
    { bpm: 174, offsetSeconds: 0.05 },
    { bpm: 140.5, offsetSeconds: 0.2 },
  ])("finds $bpm BPM with offset $offsetSeconds s", ({ bpm, offsetSeconds }) => {
    const samples = makeClickTrack({ bpm, offsetSeconds, durationSeconds: 40, sampleRate: SAMPLE_RATE, accentEvery: 4, noiseLevel: 0.02 });
    const analysis = analyseSong([samples], SAMPLE_RATE);
    expect(analysis.tempo.bpm).toBeCloseTo(bpm, 0);
    expect(Math.abs(analysis.tempo.bpm - bpm)).toBeLessThan(0.01);
    const period = 60 / bpm;
    const phaseError = Math.abs(((analysis.tempo.offsetSeconds - offsetSeconds) % period + period * 1.5) % period - period / 2);
    expect(phaseError * 1000).toBeLessThan(2);
  });

  it.each([
    { bpm: 128, firstDownbeatSeconds: 0.437 },
    { bpm: 95, firstDownbeatSeconds: 1.21 },
    { bpm: 172, firstDownbeatSeconds: 0.08 },
    { bpm: 117.5, firstDownbeatSeconds: 0.6 },
  ])("locks onto the beat and the bar of a band at $bpm BPM", ({ bpm, firstDownbeatSeconds }) => {
    const samples = makeBandTrack({ bpm, firstDownbeatSeconds, durationSeconds: 60, sampleRate: 44100, jitterMs: 6 });
    const { tempo } = analyseSong([samples], 44100);
    expect(Math.abs(tempo.bpm - bpm)).toBeLessThan(0.05);
    const halfBar = (2 * 60) / bpm;
    const kickBeatError = ((tempo.offsetSeconds - firstDownbeatSeconds) % halfBar + halfBar * 1.5) % halfBar - halfBar / 2;
    expect(Math.abs(kickBeatError) * 1000).toBeLessThan(3);
    expect(tempo.driftMs).toBeLessThan(5);
  });

  it("puts beat 1 on the bar's downbeat when the downbeat is distinct", () => {
    const bpm = 124;
    const samples = makeBandTrack({ bpm, firstDownbeatSeconds: 0.73, durationSeconds: 60, sampleRate: 44100, jitterMs: 4, kickOnThree: false });
    const { tempo } = analyseSong([samples], 44100);
    const bar = (4 * 60) / bpm;
    const barError = ((tempo.offsetSeconds - 0.73) % bar + bar * 1.5) % bar - bar / 2;
    expect(Math.abs(barError) * 1000).toBeLessThan(3);
  });

  it("reports drift when the tempo changes part way through", () => {
    const first = makeBandTrack({ bpm: 120, firstDownbeatSeconds: 0.5, durationSeconds: 30, sampleRate: 22050, jitterMs: 0 });
    const second = makeBandTrack({ bpm: 126, firstDownbeatSeconds: 0, durationSeconds: 30, sampleRate: 22050, jitterMs: 0 });
    const joined = new Float32Array(first.length + second.length);
    joined.set(first);
    joined.set(second, first.length);
    expect(analyseSong([joined], 22050).tempo.driftMs).toBeGreaterThan(25);
  });

  it("finds one onset per click", () => {
    const samples = makeClickTrack({ bpm: 120, offsetSeconds: 0.5, durationSeconds: 10, sampleRate: SAMPLE_RATE, noiseLevel: 0.01 });
    const analysis = analyseSong([samples], SAMPLE_RATE);
    const strong = analysis.onsets.filter((onset) => onset.strength > 0.3);
    expect(strong.length).toBeGreaterThanOrEqual(18);
    expect(strong.length).toBeLessThanOrEqual(20);
    for (const onset of strong) {
      const nearestBeatTime = 0.5 + Math.round((onset.seconds - 0.5) / 0.5) * 0.5;
      expect(Math.abs(onset.seconds - nearestBeatTime)).toBeLessThan(0.03);
    }
  });

  it("reports silence as having no onsets and no confidence", () => {
    const analysis = analyseSong([new Float32Array(SAMPLE_RATE * 5)], SAMPLE_RATE);
    expect(analysis.onsets).toEqual([]);
    expect(analysis.tempo.confidence).toBe(0);
    expect(analysis.durationSeconds).toBe(5);
  });
});

describe("waveform and energy", () => {
  it("averages channels to mono", () => {
    const mono = mixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0, 0]);
  });

  it("refuses audio without channels", () => {
    expect(() => mixToMono([])).toThrow(/no channels/);
  });

  it("keeps the min and max of each bucket", () => {
    const peaks = computePeaks(new Float32Array([0.1, -0.5, 0.3, 0.9, -0.2]), 10, 2);
    expect(Array.from(peaks.max)).toEqual([0.1, 0.9, 0].map((value) => Math.fround(value)));
    expect(Array.from(peaks.min)).toEqual([-0.5, 0, -0.2].map((value) => Math.fround(value)));
  });

  it("normalises loudness to 0..1 over time", () => {
    const samples = new Float32Array(SAMPLE_RATE * 2);
    for (let index = SAMPLE_RATE; index < samples.length; index += 1) samples[index] = Math.sin(index / 5) * 0.8;
    const energy = energyCurve(samples, SAMPLE_RATE);
    expect(energyAt(energy, 0.1)).toBe(0);
    expect(energyAt(energy, 1.5)).toBeGreaterThan(0.9);
    expect(energyAt(energy, 99)).toBe(0);
  });
});
