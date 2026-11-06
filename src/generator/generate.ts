import { type Onset, energyAt } from "../audio/analysis";
import type { IdFactory } from "../core/edit";
import { sortChart } from "../core/edit";
import type { Bomb, Chart, CutDirection, Difficulty, Note, NoteColor, Timing, Wall } from "../core/model";
import { beatToSeconds, secondsPerBeat, secondsToBeat } from "../core/timing";
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
const MIN_ENERGY_FACTOR = 0.3;
const ONSET_WINDOW_SECONDS = 0.07;
const WHOLE_BEAT_BONUS = 0.2;
const DOWNBEAT_BONUS = 0.1;
const FILLER_ENERGY = 0.35;
const FILLER_SCORE = 0.05;
const STRONG_HIT = 0.55;
const TAIL_SECONDS = 1;
const LEAD_IN_SECONDS = 2;
const GRID_MATCH_SECONDS = 0.02;
const GRID_ONSET_MIN_STRENGTH = 0.2;
const REST_FOR_WALL_BEATS = 4;
const REST_FOR_BOMB_BEATS = 2;
const FULL_HEIGHT = 5;
const DODGE_WALL_BEATS = 2;
const BOMB_ROW = 2;

type Swing = "down" | "up";
type Hand = NoteColor;

interface HandState {
  lastBeat: number;
  lastSwing: Swing;
}

interface Hit {
  beat: number;
  strength: number;
}

const HAND_COLUMNS: Record<Hand, readonly [number, number]> = { red: [0, 1], blue: [3, 2] };

export function generateChart(input: GeneratorInput, difficulty: Difficulty, seed: string, makeId: IdFactory): Chart {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const random = seededRandom(hashSeed(`${seed}:${difficulty}`));
  const hits = chooseHits(input, profile);
  const walls = profile.wallsInRests ? restWalls(hits, input, makeId) : [];
  const notes = assignHands(hits, profile, random, makeId);
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

function nextSwing(state: HandState, beat: number, profile: DifficultyProfile): Swing {
  if (beat - state.lastBeat >= profile.restResetBeats) return "down";
  return state.lastSwing === "down" ? "up" : "down";
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

function pickRow(swing: Swing, column: number, random: Random): number {
  const isCenterColumn = column === 1 || column === 2;
  const rows: (readonly [number, number])[] = swing === "down"
    ? [[0, 0.55], [1, isCenterColumn ? 0 : 0.15], [2, 0.3]]
    : [[0, 0.8], [1, isCenterColumn ? 0 : 0.2]];
  return pickWeighted(random, rows);
}

function pickDirection(swing: Swing, hand: Hand, column: number, profile: DifficultyProfile, random: Random): CutDirection {
  if (chance(random, profile.dotChance)) return "any";
  if (!chance(random, profile.angledChance)) return swing;
  const isOuter = column === 0 || column === 3;
  const leansLeft = isOuter ? hand === "red" : chance(random, 0.5);
  if (swing === "down") return leansLeft ? "downLeft" : "downRight";
  return leansLeft ? "upLeft" : "upRight";
}

function placeNote(hand: Hand, beat: number, swing: Swing, profile: DifficultyProfile, random: Random, makeId: IdFactory, row?: number): Note {
  const [outer, inner] = HAND_COLUMNS[hand];
  const x = chance(random, 0.55) ? inner : outer;
  const y = row ?? pickRow(swing, x, random);
  const safeY = (x === 1 || x === 2) && y === 1 ? 0 : y;
  return { id: makeId(), beat, x, y: safeY, color: hand, direction: pickDirection(swing, hand, x, profile, random) };
}

function pointsRight(direction: CutDirection): boolean {
  return direction === "downRight" || direction === "upRight" || direction === "right";
}

function pointsLeft(direction: CutDirection): boolean {
  return direction === "downLeft" || direction === "upLeft" || direction === "left";
}

function withoutInwardAngles(red: Note, blue: Note, swing: Swing): [Note, Note] {
  const crosses = pointsRight(red.direction) || pointsLeft(blue.direction);
  if (!crosses) return [red, blue];
  return [{ ...red, direction: swing }, { ...blue, direction: swing }];
}

function assignHands(hits: readonly Hit[], profile: DifficultyProfile, random: Random, makeId: IdFactory): Note[] {
  const hands: Record<Hand, HandState> = {
    red: { lastBeat: -Infinity, lastSwing: "up" },
    blue: { lastBeat: -Infinity, lastSwing: "up" },
  };
  const notes: Note[] = [];
  for (const hit of hits) {
    const bothFree = handIsFree(hands.red, hit.beat, profile) && handIsFree(hands.blue, hit.beat, profile);
    const redSwing = nextSwing(hands.red, hit.beat, profile);
    const blueSwing = nextSwing(hands.blue, hit.beat, profile);
    const wantsDouble = bothFree && redSwing === blueSwing && hit.strength >= STRONG_HIT && chance(random, profile.doubleChance);
    if (wantsDouble) {
      const red = placeNote("red", hit.beat, redSwing, profile, random, makeId);
      const blue = placeNote("blue", hit.beat, blueSwing, profile, random, makeId, red.y);
      notes.push(...withoutInwardAngles(red, blue, redSwing));
      hands.red = { lastBeat: hit.beat, lastSwing: redSwing };
      hands.blue = { lastBeat: hit.beat, lastSwing: blueSwing };
      continue;
    }
    const hand = pickHand(hands, hit.beat, profile, random);
    if (!hand) continue;
    const swing = nextSwing(hands[hand], hit.beat, profile);
    notes.push(placeNote(hand, hit.beat, swing, profile, random, makeId));
    hands[hand] = { lastBeat: hit.beat, lastSwing: swing };
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
