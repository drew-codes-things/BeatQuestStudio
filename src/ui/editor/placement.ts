import { addArc, addBomb, addChain, addNote, addWall, BEAT_EPSILON, type IdFactory, removeObjects } from "../../core/edit";
import { type Chart, type CutDirection, GRID_COLUMNS, type Note, type NoteColor } from "../../core/model";
import type { Cell } from "./geometry";

export type Tool = "select" | "red" | "blue" | "bomb" | "wall";
export type WallShape = "full" | "crouch";

export interface PlacementSettings {
  tool: Tool;
  direction: CutDirection;
  wallWidth: number;
  wallShape: WallShape;
}

export interface PlacementResult {
  chart: Chart;
  id: string;
}

const FULL_WALL = { y: 0, height: 5 };
const CROUCH_WALL = { y: 2, height: 3 };
const DEFAULT_CHAIN_SEGMENTS = 5;
const DEFAULT_CHAIN_SQUISH = 1;
const DEFAULT_ARC_MULTIPLIER = 1;

function occupantsAt(chart: Chart, beat: number, cell: Cell): Set<string> {
  const same = (object: { beat: number; x: number; y: number }) => Math.abs(object.beat - beat) < BEAT_EPSILON && object.x === cell.x && object.y === cell.y;
  return new Set([...chart.notes.filter(same), ...chart.bombs.filter(same)].map((object) => object.id));
}

export function placeAt(chart: Chart, beat: number, cell: Cell, settings: PlacementSettings, makeId: IdFactory): PlacementResult | null {
  if (settings.tool === "select" || settings.tool === "wall") return null;
  const cleared = removeObjects(chart, occupantsAt(chart, beat, cell));
  const id = makeId();
  if (settings.tool === "bomb") return { chart: addBomb(cleared, { id, beat, x: cell.x, y: cell.y }), id };
  const color: NoteColor = settings.tool;
  return { chart: addNote(cleared, { id, beat, x: cell.x, y: cell.y, color, direction: settings.direction }), id };
}

export function placeWall(chart: Chart, fromBeat: number, toBeat: number, column: number, settings: PlacementSettings, makeId: IdFactory): PlacementResult | null {
  const beat = Math.min(fromBeat, toBeat);
  const durationBeats = Math.abs(toBeat - fromBeat);
  if (durationBeats < BEAT_EPSILON) return null;
  const width = Math.max(1, Math.min(GRID_COLUMNS, settings.wallWidth));
  const x = Math.max(0, Math.min(GRID_COLUMNS - width, column));
  const shape = settings.wallShape === "full" ? FULL_WALL : CROUCH_WALL;
  const id = makeId();
  return { chart: addWall(chart, { id, beat, durationBeats, x, width, ...shape }), id };
}

export type SliderResult = { chart: Chart; id: string } | { error: string };

function twoNotesOfOneColor(chart: Chart, ids: ReadonlySet<string>): [Note, Note] | string {
  const notes = chart.notes.filter((note) => ids.has(note.id)).sort((left, right) => left.beat - right.beat);
  if (notes.length !== 2) return "Select exactly two notes: the start and the end.";
  const [head, tail] = notes as [Note, Note];
  if (head.color !== tail.color) return "Both notes must be the same colour.";
  if (tail.beat - head.beat < BEAT_EPSILON) return "The two notes must be at different beats.";
  return [head, tail];
}

export function arcFromSelection(chart: Chart, ids: ReadonlySet<string>, makeId: IdFactory): SliderResult {
  const pair = twoNotesOfOneColor(chart, ids);
  if (typeof pair === "string") return { error: pair };
  const [head, tail] = pair;
  const id = makeId();
  return {
    id,
    chart: addArc(chart, {
      id, beat: head.beat, x: head.x, y: head.y, color: head.color, direction: head.direction, headMultiplier: DEFAULT_ARC_MULTIPLIER,
      tailBeat: tail.beat, tailX: tail.x, tailY: tail.y, tailDirection: tail.direction, tailMultiplier: DEFAULT_ARC_MULTIPLIER,
    }),
  };
}

export function chainFromSelection(chart: Chart, ids: ReadonlySet<string>, makeId: IdFactory): SliderResult {
  const pair = twoNotesOfOneColor(chart, ids);
  if (typeof pair === "string") return { error: pair };
  const [head, tail] = pair;
  if (head.direction === "any") return { error: "A chain needs a head note with a direction, not a dot." };
  const id = makeId();
  const withoutTail = removeObjects(chart, new Set([tail.id]));
  return {
    id,
    chart: addChain(withoutTail, {
      id, beat: head.beat, x: head.x, y: head.y, color: head.color, direction: head.direction,
      tailBeat: tail.beat, tailX: tail.x, tailY: tail.y, segments: DEFAULT_CHAIN_SEGMENTS, squish: DEFAULT_CHAIN_SQUISH,
    }),
  };
}
