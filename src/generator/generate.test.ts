import { describe, expect, it } from "vitest";
import { analyseSong } from "../audio/analysis";
import { makeClickTrack } from "../audio/testSignals";
import { DIFFICULTIES, type Difficulty, newProject, type Project } from "../core/model";
import { validateChart } from "../validation/validate";
import { measureFlow, swingKind } from "./flowMetrics";
import { barIntensities, FIXED_MAP_SEED, generateChart, type GeneratorInput } from "./generate";
import { DIFFICULTY_PROFILES } from "./profiles";

const SAMPLE_RATE = 22050;
const BPM = 120;
const OFFSET = 0.25;
const DURATION = 90;
const OWN_SIDE_AT_LEAST: Record<Difficulty, number> = { Easy: 0.85, Normal: 0.85, Hard: 0.85, Expert: 0.85, ExpertPlus: 0.75 };

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

function verseThenChorus(): GeneratorInput {
  const song = makeClickTrack({ bpm: BPM * 4, offsetSeconds: OFFSET, durationSeconds: 60, sampleRate: SAMPLE_RATE, accentEvery: 4, noiseLevel: 0.02 });
  const chorusStart = Math.round(30 * SAMPLE_RATE);
  for (let index = 0; index < chorusStart; index += 1) song[index] = song[index]! * 0.75;
  const analysis = analyseSong([song], SAMPLE_RATE);
  return { timing: { bpm: BPM, offsetSeconds: OFFSET }, durationSeconds: analysis.durationSeconds, onsets: analysis.onsets, energy: analysis.energy };
}

describe("intensity", () => {
  it("ranks each bar's loudness within the song, ignoring silence", () => {
    const intensities = barIntensities([0, 0.6, 0.9, 0.6, 0.7]);
    expect(intensities[1]).toBeCloseTo(intensities[3]!);
    expect(intensities[2]).toBeGreaterThan(intensities[4]!);
    expect(intensities[4]).toBeGreaterThan(intensities[1]!);
    expect(Math.min(...intensities.slice(1))).toBeCloseTo(0.3 + (1.35 - 0.3) / 6);
    expect(Math.max(...intensities)).toBeCloseTo(1.35);
    expect(barIntensities([0.5])).toEqual([0.3 + (1.35 - 0.3) / 2]);
  });

  it.each(["Normal", "Expert", "ExpertPlus"] as const)("makes a loud chorus clearly busier than a quieter verse in %s, like human maps do", (difficulty) => {
    const input = verseThenChorus();
    const notes = generateChart(input, difficulty, FIXED_MAP_SEED, counter()).notes;
    const seconds = (beat: number) => OFFSET + beat * (60 / BPM);
    const verse = notes.filter((note) => seconds(note.beat) >= 5 && seconds(note.beat) < 28).length;
    const chorus = notes.filter((note) => seconds(note.beat) >= 32 && seconds(note.beat) < 55).length;
    expect(chorus / verse).toBeGreaterThan(1.6);
  });
});

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

  it.each(DIFFICULTIES)("keeps each hand mostly on its own side in %s", (difficulty) => {
    const notes = charts[difficulty].notes;
    const onOwnSide = notes.filter((note) => (note.color === "red" ? note.x <= 1 : note.x >= 2)).length;
    expect(onOwnSide / notes.length).toBeGreaterThan(OWN_SIDE_AT_LEAST[difficulty]);
  });

  it.each(DIFFICULTIES)("alternates forehand and backhand like a human map in %s", (difficulty) => {
    expect(measureFlow(charts[difficulty].notes, DURATION).parityFlipRate).toBeGreaterThanOrEqual(0.98);
  });

  it.each(DIFFICULTIES)("hits downswings low and upswings higher like a human map in %s", (difficulty) => {
    const flow = measureFlow(charts[difficulty].notes, DURATION);
    expect(flow.downOnBottomShare).toBeGreaterThan(0.8);
    expect(flow.upAboveBottomShare).toBeGreaterThan(0.6);
  });

  it("puts both hands on some strong hits in Normal and above", () => {
    for (const difficulty of ["Normal", "Hard", "Expert"] as const) expect(measureFlow(charts[difficulty].notes, DURATION).doubleShare).toBeGreaterThan(0.03);
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
    const vertical = charts.Easy.notes.map((note) => swingKind(note.direction)).filter((kind) => kind === "down" || kind === "up");
    expect(vertical.filter((kind) => kind === "up").length).toBeGreaterThan(vertical.length / 3);
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

  it("has one fixed seed, so the same song always gets the same map whatever the note ids are", () => {
    const placement = (chart: ReturnType<typeof generateChart>) => chart.notes.map((note) => [note.beat, note.x, note.y, note.color, note.direction]);
    let next = 0;
    const first = generateChart(input, "Expert", FIXED_MAP_SEED, counter());
    const second = generateChart(input, "Expert", FIXED_MAP_SEED, () => `other-${next++}`);
    expect(typeof FIXED_MAP_SEED).toBe("string");
    expect(FIXED_MAP_SEED.length).toBeGreaterThan(0);
    expect(first.notes.length).toBeGreaterThan(0);
    expect(placement(second)).toEqual(placement(first));
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
