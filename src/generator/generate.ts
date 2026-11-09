import { type Onset, type SongAnalysis, energyAt } from "../audio/analysis";
import type { IdFactory } from "../core/edit";
import { sortChart } from "../core/edit";
import type { Bomb, Chart, Difficulty, Note, NoteColor, Timing, Wall } from "../core/model";
import { beatToSeconds, secondsPerBeat, secondsToBeat } from "../core/timing";
import { swingKind } from "./flowMetrics";
import { type DifficultyFlow, FLOW_TABLE, type FlowState, fromRedFrame, gapBucket, parseStateKey, toRedFrame, transitionKey } from "./flowTable";
import { DIFFICULTY_PROFILES, type DifficultyProfile } from "./profiles";
import { chance, hashSeed, pickWeighted, type Random, seededRandom } from "./random";

export interface GeneratorInput {
  timing: Timing;
  durationSeconds: number;
  onsets: readonly Onset[];
  energy: Float32Array;
}

const BEATS_PER_BAR = 4;
const SILENT_ENERGY = 0.08;
const MIN_ENERGY_FACTOR = 0.5;
const ONSET_WINDOW_SECONDS = 0.07;
const WHOLE_BEAT_BONUS = 0.2;
const DOWNBEAT_BONUS = 0.1;
const FILLER_ENERGY = 0.35;
const FILLER_SCORE = 0.05;
const STRONG_HIT = 0.3;
const TAIL_SECONDS = 1;
const LEAD_IN_SECONDS = 2;
const GRID_MATCH_SECONDS = 0.02;
const GRID_ONSET_MIN_STRENGTH = 0.2;
const REST_FOR_WALL_BEATS = 4;
const REST_FOR_BOMB_BEATS = 2;
const FULL_HEIGHT = 5;
const DODGE_WALL_BEATS = 2;
const BOMB_ROW = 2;

type Hand = NoteColor;
type VerticalSwing = "down" | "up";

interface HandState {
  lastBeat: number;
  last: FlowState | null;
  lastSwing: VerticalSwing | null;
}

interface Hit {
  beat: number;
  strength: number;
}

type WeightedState = readonly [FlowState, number];

const MIN_TRANSITION_SUPPORT = 12;
const CROSSOVER_WINDOW_BEATS = 1;
const TRANSITION_FLOOR = 0.02;
const OUTER_COLUMNS: Record<Hand, number> = { red: 0, blue: 3 };

export const FIXED_MAP_SEED = "s16";

export function generateChart(input: GeneratorInput, difficulty: Difficulty, seed: string, makeId: IdFactory): Chart {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const random = seededRandom(hashSeed(`${seed}:${difficulty}`));
  const hits = chooseHits(input, profile);
  const walls = profile.wallsInRests ? restWalls(hits, input, makeId) : [];
  const context: FlowContext = { flow: FLOW_TABLE.tiers[difficulty], secondsEachBeat: secondsPerBeat(input.timing), random };
  const notes = assignHands(hits, profile, context, makeId);
  const dodgeWalls = dodgeWallsAround(notes, input, profile, random, makeId);
  const bombs = profile.bombsInRests ? restBombs(hits, input, makeId) : [];
  return sortChart({ notes, bombs, walls: [...walls, ...dodgeWalls], arcs: [], chains: [] });
}

function onsetScore(onsets: readonly Onset[], seconds: number, window: number): number {
  let best = 0;
  let low = 0;
  let high = onsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (onsets[middle]!.seconds < seconds - window) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < onsets.length && onsets[index]!.seconds <= seconds + window; index += 1) best = Math.max(best, onsets[index]!.strength);
  return best;
}

function candidateScore(input: GeneratorInput, divisionsPerBeat: number, beat: number): number {
  const seconds = beatToSeconds(beat, input.timing);
  const window = Math.min(ONSET_WINDOW_SECONDS, (secondsPerBeat(input.timing) / divisionsPerBeat) / 2);
  let score = onsetScore(input.onsets, seconds, window);
  const energy = energyAt(input.energy, seconds);
  if (score === 0 && Number.isInteger(beat) && energy > FILLER_ENERGY) score = FILLER_SCORE;
  if (score === 0) return 0;
  if (Number.isInteger(beat)) score += WHOLE_BEAT_BONUS;
  if (beat % BEATS_PER_BAR === 0) score += DOWNBEAT_BONUS;
  return score;
}

function gridMatches(input: GeneratorInput, barStart: number, divisionsPerBeat: number): number {
  const from = beatToSeconds(barStart, input.timing);
  const to = beatToSeconds(barStart + BEATS_PER_BAR, input.timing);
  let matches = 0;
  for (const onset of input.onsets) {
    if (onset.seconds < from || onset.seconds >= to || onset.strength < GRID_ONSET_MIN_STRENGTH) continue;
    const beat = secondsToBeat(onset.seconds, input.timing);
    const nearest = Math.round(beat * divisionsPerBeat) / divisionsPerBeat;
    if (Math.abs(beatToSeconds(nearest, input.timing) - onset.seconds) <= GRID_MATCH_SECONDS) matches += 1;
  }
  return matches;
}

export type SongFeatures = Pick<SongAnalysis, "durationSeconds" | "onsets" | "energy">;

export function generateCharts(timing: Timing, song: SongFeatures, difficulties: readonly Difficulty[], seed: string, makeId: IdFactory): Partial<Record<Difficulty, Chart>> {
  const input: GeneratorInput = { timing, durationSeconds: song.durationSeconds, onsets: song.onsets, energy: song.energy };
  return Object.fromEntries(difficulties.map((difficulty) => [difficulty, generateChart(input, difficulty, seed, makeId)]));
}

export function barDivisions(input: GeneratorInput, profile: DifficultyProfile, barStart: number): number {
  if (profile.tripletDivisionsPerBeat === null) return profile.divisionsPerBeat;
  const straight = gridMatches(input, barStart, profile.divisionsPerBeat);
  const triplet = gridMatches(input, barStart, profile.tripletDivisionsPerBeat);
  return triplet > straight ? profile.tripletDivisionsPerBeat : profile.divisionsPerBeat;
}

function chooseHits(input: GeneratorInput, profile: DifficultyProfile): Hit[] {
  const firstBeat = Math.max(0, Math.ceil(secondsToBeat(LEAD_IN_SECONDS, input.timing)));
  const lastBeat = Math.floor(secondsToBeat(input.durationSeconds - TAIL_SECONDS, input.timing));
  const barSeconds = BEATS_PER_BAR * secondsPerBeat(input.timing);
  const hits: Hit[] = [];
  for (let barStart = firstBeat - (firstBeat % BEATS_PER_BAR); barStart <= lastBeat; barStart += BEATS_PER_BAR) {
    const energy = energyAt(input.energy, beatToSeconds(barStart + BEATS_PER_BAR / 2, input.timing));
    if (energy < SILENT_ENERGY) continue;
    const energyFactor = MIN_ENERGY_FACTOR + (1 - MIN_ENERGY_FACTOR) * energy;
    const target = Math.max(1, Math.round(profile.notesPerSecondAtFullEnergy * energyFactor * barSeconds));
    const divisions = barDivisions(input, profile, barStart);
    const candidates: Hit[] = [];
    for (let step = 0; step < BEATS_PER_BAR * divisions; step += 1) {
      const beat = barStart + step / divisions;
      if (beat < firstBeat || beat > lastBeat) continue;
      const strength = candidateScore(input, divisions, beat);
      if (strength > 0) candidates.push({ beat, strength });
    }
    candidates.sort((left, right) => right.strength - left.strength || left.beat - right.beat);
    const chosen: Hit[] = [];
    for (const candidate of candidates) {
      if (chosen.length >= target) break;
      const previous = hits[hits.length - 1];
      const tooCloseToPreviousBar = previous !== undefined && candidate.beat - previous.beat < profile.minGapBeats - 1e-9;
      const tooCloseInBar = chosen.some((hit) => Math.abs(hit.beat - candidate.beat) < profile.minGapBeats - 1e-9);
      if (!tooCloseToPreviousBar && !tooCloseInBar) chosen.push(candidate);
    }
    hits.push(...chosen.sort((left, right) => left.beat - right.beat));
  }
  return hits;
}

function handIsFree(state: HandState, beat: number, profile: DifficultyProfile): boolean {
  return beat - state.lastBeat >= profile.minSameHandGapBeats - 1e-9;
}

function pickHand(hands: Record<Hand, HandState>, beat: number, profile: DifficultyProfile, random: Random): Hand | null {
  const redFree = handIsFree(hands.red, beat, profile);
  const blueFree = handIsFree(hands.blue, beat, profile);
  if (redFree && !blueFree) return "red";
  if (blueFree && !redFree) return "blue";
  if (!redFree && !blueFree) return null;
  if (hands.red.lastBeat === hands.blue.lastBeat) return chance(random, 0.5) ? "red" : "blue";
  return hands.red.lastBeat < hands.blue.lastBeat ? "red" : "blue";
}

function oppositeSwing(swing: VerticalSwing | null): VerticalSwing | null {
  if (swing === null) return null;
  return swing === "down" ? "up" : "down";
}

function swingAfter(state: HandState, next: FlowState): VerticalSwing | null {
  const kind = swingKind(next.direction);
  return kind === "down" || kind === "up" ? kind : oppositeSwing(state.lastSwing);
}

function keepsParity(state: HandState, next: FlowState): boolean {
  const kind = swingKind(next.direction);
  if (kind !== "down" && kind !== "up") return true;
  return state.lastSwing !== kind;
}

function blocksVision(state: FlowState): boolean {
  return state.y === 1 && (state.x === 1 || state.x === 2);
}

function staysOnOwnSide(hand: Hand, next: FlowState, other: HandState, beat: number): boolean {
  if (!other.last || beat - other.lastBeat > CROSSOVER_WINDOW_BEATS) return true;
  if (next.x === other.last.x && next.y === other.last.y) return false;
  return hand === "red" ? next.x <= other.last.x : next.x >= other.last.x;
}

function weightedKeys(entries: readonly (readonly [string, number])[], hand: Hand): WeightedState[] {
  return entries.map(([key, count]) => [fromRedFrame(parseStateKey(key), hand), count] as const);
}

function totalCount(entries: readonly (readonly [string, number])[]): number {
  return entries.reduce((sum, [, count]) => sum + count, 0);
}

function nextOptions(flow: DifficultyFlow, hand: Hand, state: HandState, beat: number, secondsEachBeat: number): WeightedState[] {
  if (!state.last) return weightedKeys(flow.starts, hand);
  const previous = toRedFrame(state.last, hand);
  const bucket = gapBucket((beat - state.lastBeat) * secondsEachBeat);
  const specific = flow.transitions[transitionKey(bucket, previous)] ?? [];
  const rows = totalCount(specific) >= MIN_TRANSITION_SUPPORT ? specific : flow.transitions[transitionKey("any", previous)] ?? [];
  return weightedKeys(rows, hand);
}

function fallbackState(hand: Hand, state: HandState): FlowState {
  const swing = oppositeSwing(state.lastSwing) ?? "down";
  return { x: OUTER_COLUMNS[hand], y: swing === "down" ? 0 : 2, direction: swing };
}

function pickState(random: Random, options: readonly WeightedState[]): FlowState | null {
  if (options.length === 0) return null;
  return pickWeighted(random, options);
}

function sameState(left: FlowState, right: FlowState): boolean {
  return left.x === right.x && left.y === right.y && left.direction === right.direction;
}

function transitionShare(options: readonly WeightedState[], target: FlowState): number {
  const total = options.reduce((sum, [, count]) => sum + count, 0);
  const match = options.find(([state]) => sameState(state, target));
  return total === 0 || !match ? TRANSITION_FLOOR : Math.max(TRANSITION_FLOOR, match[1] / total);
}

function moveHand(state: HandState, beat: number, next: FlowState): HandState {
  return { lastBeat: beat, last: next, lastSwing: swingAfter(state, next) };
}

function noteFrom(hand: Hand, beat: number, state: FlowState, makeId: IdFactory): Note {
  return { id: makeId(), beat, x: state.x, y: state.y, color: hand, direction: state.direction };
}

interface FlowContext {
  flow: DifficultyFlow;
  secondsEachBeat: number;
  random: Random;
}

function placeSingle(context: FlowContext, hands: Record<Hand, HandState>, hand: Hand, beat: number): FlowState {
  const other = hands[hand === "red" ? "blue" : "red"];
  const fits = ([candidate]: WeightedState) => keepsParity(hands[hand], candidate) && !blocksVision(candidate) && staysOnOwnSide(hand, candidate, other, beat);
  const options = nextOptions(context.flow, hand, hands[hand], beat, context.secondsEachBeat).filter(fits);
  return pickState(context.random, options) ?? fallbackState(hand, hands[hand]);
}

function placeDouble(context: FlowContext, hands: Record<Hand, HandState>, beat: number): [FlowState, FlowState] | null {
  const redOptions = nextOptions(context.flow, "red", hands.red, beat, context.secondsEachBeat);
  const blueOptions = nextOptions(context.flow, "blue", hands.blue, beat, context.secondsEachBeat);
  const pairs = context.flow.doubles.flatMap(([redKey, blueKey, count]) => {
    const red = parseStateKey(redKey);
    const blue = fromRedFrame(parseStateKey(blueKey), "blue");
    const fits = keepsParity(hands.red, red) && keepsParity(hands.blue, blue)
      && red.x <= blue.x && !(red.x === blue.x && red.y === blue.y)
      && !blocksVision(red) && !blocksVision(blue);
    if (!fits) return [];
    const weight = count * transitionShare(redOptions, red) * transitionShare(blueOptions, blue);
    const pair: [FlowState, FlowState] = [red, blue];
    return [[pair, weight] as const];
  });
  if (pairs.length === 0) return null;
  return pickWeighted(context.random, pairs);
}

function assignHands(hits: readonly Hit[], profile: DifficultyProfile, context: FlowContext, makeId: IdFactory): Note[] {
  const hands: Record<Hand, HandState> = {
    red: { lastBeat: -Infinity, last: null, lastSwing: null },
    blue: { lastBeat: -Infinity, last: null, lastSwing: null },
  };
  const notes: Note[] = [];
  for (const hit of hits) {
    const bothFree = handIsFree(hands.red, hit.beat, profile) && handIsFree(hands.blue, hit.beat, profile);
    const wantsDouble = bothFree && hit.strength >= STRONG_HIT && chance(context.random, profile.doubleChance);
    const double = wantsDouble ? placeDouble(context, hands, hit.beat) : null;
    if (double) {
      const [red, blue] = double;
      notes.push(noteFrom("red", hit.beat, red, makeId), noteFrom("blue", hit.beat, blue, makeId));
      hands.red = moveHand(hands.red, hit.beat, red);
      hands.blue = moveHand(hands.blue, hit.beat, blue);
      continue;
    }
    const hand = pickHand(hands, hit.beat, profile, context.random);
    if (!hand) continue;
    const next = placeSingle(context, hands, hand, hit.beat);
    notes.push(noteFrom(hand, hit.beat, next, makeId));
    hands[hand] = moveHand(hands[hand], hit.beat, next);
  }
  return notes;
}

interface Rest {
  fromBeat: number;
  toBeat: number;
}

function restsBetween(hits: readonly Hit[], input: GeneratorInput, minimumBeats: number): Rest[] {
  const rests: Rest[] = [];
  for (let index = 1; index < hits.length; index += 1) {
    const fromBeat = hits[index - 1]!.beat;
    const toBeat = hits[index]!.beat;
    const middleSeconds = beatToSeconds((fromBeat + toBeat) / 2, input.timing);
    if (toBeat - fromBeat >= minimumBeats && energyAt(input.energy, middleSeconds) >= SILENT_ENERGY) rests.push({ fromBeat, toBeat });
  }
  return rests;
}

function restWalls(hits: readonly Hit[], input: GeneratorInput, makeId: IdFactory): Wall[] {
  return restsBetween(hits, input, REST_FOR_WALL_BEATS).flatMap(({ fromBeat, toBeat }) => {
    const beat = fromBeat + 1;
    const durationBeats = toBeat - fromBeat - 2;
    if (durationBeats <= 0) return [];
    return [0, 3].map((x) => ({ id: makeId(), beat, x, y: 0, durationBeats, width: 1, height: FULL_HEIGHT }));
  });
}

function columnIsFree(notes: readonly Note[], column: number, fromBeat: number, toBeat: number): boolean {
  return !notes.some((note) => note.x === column && note.beat >= fromBeat - 0.5 && note.beat <= toBeat + 0.5);
}

function dodgeWallsAround(notes: readonly Note[], input: GeneratorInput, profile: DifficultyProfile, random: Random, makeId: IdFactory): Wall[] {
  if (profile.dodgeWallsPerBar === 0 || notes.length === 0) return [];
  const walls: Wall[] = [];
  const firstBar = Math.ceil(notes[0]!.beat / BEATS_PER_BAR) * BEATS_PER_BAR;
  const lastBeat = notes[notes.length - 1]!.beat;
  for (let bar = firstBar; bar + DODGE_WALL_BEATS < lastBeat; bar += BEATS_PER_BAR) {
    if (!chance(random, profile.dodgeWallsPerBar)) continue;
    const column = chance(random, 0.5) ? 0 : 3;
    if (energyAt(input.energy, beatToSeconds(bar, input.timing)) < FILLER_ENERGY) continue;
    if (!columnIsFree(notes, column, bar, bar + DODGE_WALL_BEATS)) continue;
    walls.push({ id: makeId(), beat: bar, x: column, y: 0, durationBeats: DODGE_WALL_BEATS, width: 1, height: FULL_HEIGHT });
  }
  return walls;
}

function restBombs(hits: readonly Hit[], input: GeneratorInput, makeId: IdFactory): Bomb[] {
  return restsBetween(hits, input, REST_FOR_BOMB_BEATS).flatMap(({ fromBeat, toBeat }) => {
    const beat = Math.round((fromBeat + toBeat) / 2);
    if (beat - fromBeat < 1 || toBeat - beat < 1) return [];
    return [1, 2].map((x) => ({ id: makeId(), beat, x, y: BOMB_ROW }));
  });
}
