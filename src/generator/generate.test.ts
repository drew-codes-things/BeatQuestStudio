import { describe, expect, it } from "vitest";
import { analyseSong } from "../audio/analysis";
import { makeClickTrack } from "../audio/testSignals";
import { DIFFICULTIES, type Difficulty, newProject, type Project } from "../core/model";
import { validateChart } from "../validation/validate";
import { generateChart, type GeneratorInput } from "./generate";
import { DIFFICULTY_PROFILES } from "./profiles";

const SAMPLE_RATE = 22050;
const BPM = 120;
const OFFSET = 0.25;
const DURATION = 90;

function counter() {
  let next = 0;
  return () => `g${next++}`;
}

function buildInput(): GeneratorInput {
  const fast = makeClickTrack({ bpm: BPM * 4, offsetSeconds: OFFSET, durationSeconds: DURATION, sampleRate: SAMPLE_RATE, accentEvery: 4, noiseLevel: 0.02 });
  const quietStart = Math.round(40 * SAMPLE_RATE);
  const quietEnd = Math.round(48 * SAMPLE_RATE);
  for (let index = quietStart; index < quietEnd; index += 1) fast[index] = 0;
  const analysis = analyseSong([fast], SAMPLE_RATE);
  return { timing: { bpm: BPM, offsetSeconds: OFFSET }, durationSeconds: analysis.durationSeconds, onsets: analysis.onsets, energy: analysis.energy };
}

const input = buildInput();
const charts = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, generateChart(input, difficulty, "seed", counter())])) as Record<Difficulty, ReturnType<typeof generateChart>>;

function projectWith(difficulty: Difficulty): Project {
  const project = newProject("p", "Generated", 0);
  project.timing = input.timing;
  project.song = { title: "Clicks", subTitle: "", artist: "Test", mapper: "Test", fileName: "clicks.wav", durationSeconds: DURATION, previewStartSeconds: 0, previewDurationSeconds: 10, beatDriftMs: null };
  project.charts[difficulty] = charts[difficulty];
  return project;
}

describe("generateChart", () => {
  it("gets denser with each difficulty", () => {
    const counts = DIFFICULTIES.map((difficulty) => charts[difficulty].notes.length);
    expect(counts[0]).toBeGreaterThan(20);
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]).toBeGreaterThan(counts[index - 1]!);
  });

  it.each(DIFFICULTIES)("keeps %s on its own timing grid and gaps", (difficulty) => {
    const profile = DIFFICULTY_PROFILES[difficulty];
    const notes = charts[difficulty].notes;
    const onGrid = (beat: number, divisions: number | null) => divisions !== null && Math.abs(beat * divisions - Math.round(beat * divisions)) < 1e-6;
    for (const note of notes) expect(onGrid(note.beat, profile.divisionsPerBeat) || onGrid(note.beat, profile.tripletDivisionsPerBeat)).toBe(true);
    const beats = [...new Set(notes.map((note) => note.beat))];
    for (let index = 1; index < beats.length; index += 1) expect(beats[index]! - beats[index - 1]!).toBeGreaterThanOrEqual(profile.minGapBeats - 1e-9);
  });

  it.each(DIFFICULTIES)("keeps each hand on its own side in %s", (difficulty) => {
    for (const note of charts[difficulty].notes) {
      if (note.color === "red") expect(note.x).toBeLessThanOrEqual(1);
      else expect(note.x).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(DIFFICULTIES)("produces %s with no validation errors and no parity, vision or wall problems", (difficulty) => {
    const problems = validateChart(projectWith(difficulty), difficulty).filter((found) => found.severity === "error" || ["parity", "vision-block", "crossover", "inside-wall"].includes(found.code));
    expect(problems).toEqual([]);
  });

  it.each(DIFFICULTIES)("gives the player at least two seconds before the first note in %s", (difficulty) => {
    const first = charts[difficulty].notes[0]!;
    expect(OFFSET + first.beat * (60 / BPM)).toBeGreaterThanOrEqual(2);
  });

  it("flows down and up in Easy instead of only swinging down", () => {
    const swings = charts.Easy.notes.filter((note) => note.direction !== "any").map((note) => note.direction.startsWith("up") ? "up" : "down");
    expect(swings.filter((swing) => swing === "up").length).toBeGreaterThan(swings.length / 3);
  });

  it("leaves the silent section empty", () => {
    const silentFrom = (40 - OFFSET) * (BPM / 60) + 4;
    const silentTo = (48 - OFFSET) * (BPM / 60) - 4;
    for (const difficulty of DIFFICULTIES) {
      expect(charts[difficulty].notes.filter((note) => note.beat > silentFrom && note.beat < silentTo)).toEqual([]);
    }
  });

  it("adds walls and bombs only where the profile allows them", () => {
    expect(charts.Easy.walls).toEqual([]);
    expect(charts.Easy.bombs).toEqual([]);
    expect(charts.Normal.bombs).toEqual([]);
  });

  it("is repeatable for a seed and changes with a new one", () => {
    const again = generateChart(input, "Hard", "seed", counter());
    const other = generateChart(input, "Hard", "other", counter());
    expect(again).toEqual(charts.Hard);
    expect(other.notes.map((note) => [note.beat, note.x, note.y, note.direction])).not.toEqual(charts.Hard.notes.map((note) => [note.beat, note.x, note.y, note.direction]));
  });

  it("follows a triplet rhythm in Hard and Expert instead of forcing it onto sixteenths", () => {
    const tripletTrack = makeClickTrack({ bpm: BPM * 3, offsetSeconds: OFFSET, durationSeconds: 40, sampleRate: SAMPLE_RATE, accentEvery: 3, noiseLevel: 0.02 });
    const analysis = analyseSong([tripletTrack], SAMPLE_RATE);
    const tripletInput: GeneratorInput = { timing: { bpm: BPM, offsetSeconds: OFFSET }, durationSeconds: analysis.durationSeconds, onsets: analysis.onsets, energy: analysis.energy };
    for (const difficulty of ["Hard", "Expert"] as const) {
      const offBeats = generateChart(tripletInput, difficulty, "seed", counter()).notes.map((note) => note.beat % 1).filter((fraction) => fraction > 1e-6);
      expect(offBeats.length).toBeGreaterThan(5);
      for (const fraction of offBeats) expect(Math.min(Math.abs(fraction - 1 / 3), Math.abs(fraction - 2 / 3))).toBeLessThan(1e-6);
    }
  });

  it("makes nothing for a silent song", () => {
    const silent: GeneratorInput = { timing: { bpm: 120, offsetSeconds: 0 }, durationSeconds: 30, onsets: [], energy: new Float32Array(120) };
    const chart = generateChart(silent, "Expert", "seed", counter());
    expect(chart.notes).toEqual([]);
  });
});
