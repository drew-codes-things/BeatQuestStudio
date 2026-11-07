import { writeFileSync } from "node:fs";
import { DIFFICULTIES, type Difficulty, type Note } from "../src/core/model";
import { handSwings } from "../src/generator/flowMetrics";
import { type DifficultyFlow, type FlowTable, gapBucket, noteState, stateKey, transitionKey } from "../src/generator/flowTable";
import { readReferenceMaps } from "./referenceMaps";

const MIN_TRANSITION_COUNT = 2;
const MIN_DOUBLE_COUNT = 2;
const OUTPUT_PATH = "src/generator/flowTable.json";
const SIMULTANEOUS_BEATS = 1 / 48;

type Counter = Map<string, number>;

function bump(counter: Counter, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function bumpNested(counters: Map<string, Counter>, outer: string, inner: string): void {
  const counter = counters.get(outer) ?? new Map<string, number>();
  bump(counter, inner);
  counters.set(outer, counter);
}

function sortedEntries(counter: Counter, minimum: number): [string, number][] {
  return [...counter.entries()].filter(([, count]) => count >= minimum).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function learnChart(notes: readonly Note[], secondsPerBeat: number, starts: Counter, transitions: Map<string, Counter>, doubles: Counter): void {
  for (const color of ["red", "blue"] as const) {
    const swings = handSwings(notes, color);
    if (swings[0]) bump(starts, stateKey(noteState(swings[0])));
    for (let index = 1; index < swings.length; index += 1) {
      const previous = noteState(swings[index - 1]!);
      const next = stateKey(noteState(swings[index]!));
      const bucket = gapBucket((swings[index]!.beat - swings[index - 1]!.beat) * secondsPerBeat);
      bumpNested(transitions, transitionKey(bucket, previous), next);
      bumpNested(transitions, transitionKey("any", previous), next);
    }
  }
  const reds = handSwings(notes, "red");
  const blues = handSwings(notes, "blue");
  for (const red of reds) {
    const blue = blues.find((candidate) => Math.abs(candidate.beat - red.beat) < SIMULTANEOUS_BEATS);
    if (blue) bump(doubles, `${stateKey(noteState(red))} ${stateKey(noteState(blue))}`);
  }
}

function learnTier(difficulty: Difficulty, root: string): DifficultyFlow {
  const starts: Counter = new Map();
  const transitions = new Map<string, Counter>();
  const doubles: Counter = new Map();
  for (const map of readReferenceMaps(root)) {
    const notes = map.charts[difficulty];
    if (!notes || map.hasTempoChanges) continue;
    learnChart(notes, 60 / map.bpm, starts, transitions, doubles);
  }
  const learned: Record<string, [string, number][]> = {};
  for (const key of [...transitions.keys()].sort()) {
    const entries = sortedEntries(transitions.get(key)!, MIN_TRANSITION_COUNT);
    if (entries.length > 0) learned[key] = entries;
  }
  return {
    starts: sortedEntries(starts, 1),
    transitions: learned,
    doubles: sortedEntries(doubles, MIN_DOUBLE_COUNT).map(([pair, count]) => {
      const [red, blue] = pair.split(" ");
      return [red!, blue!, count];
    }),
  };
}

function main(): void {
  const [root, source] = process.argv.slice(2);
  if (!root || !source) throw new Error("usage: vite-node scripts/learn-flow.ts <folder of map folders> <description of the maps>");
  const tiers = Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, learnTier(difficulty, root)])) as Record<Difficulty, DifficultyFlow>;
  const table: FlowTable = { source, tiers };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(table)}\n`);
  for (const difficulty of DIFFICULTIES) {
    const tier = tiers[difficulty];
    console.log(`${difficulty}: ${Object.keys(tier.transitions).length} transition rows, ${tier.doubles.length} double pairs, ${tier.starts.length} start states`);
  }
}

main();
