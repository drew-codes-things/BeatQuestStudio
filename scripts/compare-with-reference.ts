import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { analyseSong, type Onset } from "../src/audio/analysis";
import { DIFFICULTIES, type Difficulty, type Note, type Timing } from "../src/core/model";
import { beatToSeconds } from "../src/core/timing";
import { measureFlow, type FlowMetrics } from "../src/generator/flowMetrics";
import { generateCharts } from "../src/generator/generate";
import { readReferenceMaps, type ReferenceMap } from "./referenceMaps";

const SAMPLE_RATE = 44100;
const MATCH_WINDOW_SECONDS = 0.05;
const DECODE_BUFFER_BYTES = 512 * 1024 * 1024;
const COMPARE_SEED = "compare";

interface DifficultyComparison {
  difficulty: Difficulty;
  human: FlowMetrics;
  auto: FlowMetrics;
  rhythmRecall: number;
  rhythmPrecision: number;
}

interface SongComparison {
  folder: string;
  humanBpm: number;
  autoBpm: number;
  difficulties: DifficultyComparison[];
}

function decodeMono(path: string): Float32Array {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"], { maxBuffer: DECODE_BUFFER_BYTES });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function hitTimes(notes: readonly Note[], timing: Timing): number[] {
  const unique = new Set(notes.map((note) => Math.round(beatToSeconds(note.beat, timing) * 1000)));
  return [...unique].sort((left, right) => left - right).map((milliseconds) => milliseconds / 1000);
}

function matchedShare(from: readonly number[], to: readonly number[]): number {
  if (from.length === 0) return 0;
  let cursor = 0;
  let matched = 0;
  for (const time of from) {
    while (cursor < to.length && to[cursor]! < time - MATCH_WINDOW_SECONDS) cursor += 1;
    if (cursor < to.length && Math.abs(to[cursor]! - time) <= MATCH_WINDOW_SECONDS) matched += 1;
  }
  return matched / from.length;
}

interface CachedAnalysis {
  durationSeconds: number;
  bpm: number;
  offsetSeconds: number;
  onsets: Onset[];
  energy: number[];
}

function analyseWithCache(map: ReferenceMap, cacheDirectory: string | undefined): CachedAnalysis {
  const cachePath = cacheDirectory ? join(cacheDirectory, `${basename(map.folder)}.json`) : null;
  if (cachePath && existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, "utf8")) as CachedAnalysis;
  const analysis = analyseSong([decodeMono(map.songPath!)], SAMPLE_RATE);
  const cached: CachedAnalysis = {
    durationSeconds: analysis.durationSeconds,
    bpm: analysis.tempo.bpm,
    offsetSeconds: analysis.tempo.offsetSeconds,
    onsets: analysis.onsets,
    energy: [...analysis.energy],
  };
  if (cachePath) {
    mkdirSync(cacheDirectory!, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cached));
  }
  return cached;
}

function compareSong(map: ReferenceMap, cacheDirectory: string | undefined): SongComparison {
  const cached = analyseWithCache(map, cacheDirectory);
  const analysis = { durationSeconds: cached.durationSeconds, onsets: cached.onsets, energy: Float32Array.from(cached.energy), tempo: { bpm: cached.bpm, offsetSeconds: cached.offsetSeconds } };
  const autoTiming: Timing = { bpm: analysis.tempo.bpm, offsetSeconds: analysis.tempo.offsetSeconds };
  const humanTiming: Timing = { bpm: map.bpm, offsetSeconds: 0 };
  let nextId = 0;
  const charts = generateCharts(autoTiming, analysis, DIFFICULTIES, COMPARE_SEED, () => `a${nextId++}`);
  const difficulties: DifficultyComparison[] = [];
  for (const difficulty of DIFFICULTIES) {
    const humanNotes = map.charts[difficulty];
    const autoNotes = charts[difficulty]?.notes;
    if (!humanNotes || !autoNotes || humanNotes.length === 0) continue;
    const humanTimes = hitTimes(humanNotes, humanTiming);
    const autoTimes = hitTimes(autoNotes, autoTiming);
    difficulties.push({
      difficulty,
      human: measureFlow(humanNotes, analysis.durationSeconds),
      auto: measureFlow(autoNotes, analysis.durationSeconds),
      rhythmRecall: matchedShare(humanTimes, autoTimes),
      rhythmPrecision: matchedShare(autoTimes, humanTimes),
    });
  }
  return { folder: map.folder, humanBpm: map.bpm, autoBpm: analysis.tempo.bpm, difficulties };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function tempoMatches(human: number, auto: number): boolean {
  return [0.5, 1, 2].some((factor) => Math.abs(auto - human * factor) / (human * factor) < 0.01);
}

const METRIC_KEYS: (keyof Omit<FlowMetrics, "rowShares">)[] = ["notesPerSecond", "parityFlipRate", "downOnBottomShare", "upAboveBottomShare", "doubleShare", "diagonalShare", "dotShare"];

function summarise(results: readonly SongComparison[]): void {
  const tempoHits = results.filter((result) => tempoMatches(result.humanBpm, result.autoBpm)).length;
  console.log(`tempo: ${tempoHits} of ${results.length} songs within 1% of the human BPM (or double/half)`);
  for (const difficulty of DIFFICULTIES) {
    const rows = results.flatMap((result) => result.difficulties.filter((entry) => entry.difficulty === difficulty));
    if (rows.length === 0) continue;
    const parts = METRIC_KEYS.map((key) => `${key} ${median(rows.map((row) => row.human[key])).toFixed(2)}/${median(rows.map((row) => row.auto[key])).toFixed(2)}`);
    const density = median(rows.map((row) => row.auto.notesPerSecond / row.human.notesPerSecond));
    console.log(`${difficulty} (${rows.length} songs, human/auto medians): ${parts.join(", ")}; density ratio ${density.toFixed(2)}; rhythm recall ${median(rows.map((row) => row.rhythmRecall)).toFixed(2)}, precision ${median(rows.map((row) => row.rhythmPrecision)).toFixed(2)}`);
  }
}

function main(): void {
  const [root, outputPath, cacheDirectory] = process.argv.slice(2);
  if (!root) throw new Error("usage: vite-node scripts/compare-with-reference.ts <folder of map folders> [results.json] [analysis cache folder]");
  const maps = readReferenceMaps(root).filter((map) => map.songPath && !map.hasTempoChanges);
  const results: SongComparison[] = [];
  for (const map of maps) {
    try {
      results.push(compareSong(map, cacheDirectory));
      process.stdout.write(".");
    } catch (cause) {
      console.error(`\nskipped ${map.folder}: ${(cause as Error).message}`);
    }
  }
  console.log("");
  summarise(results);
  if (outputPath) writeFileSync(outputPath, JSON.stringify(results, null, 2));
}

main();
