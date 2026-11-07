import { CUT_DIRECTIONS, type CutDirection, DIFFICULTIES, type Difficulty, type Note, type NoteColor } from "../core/model";
import learnedFlow from "./flowTable.json";

export type GapBucket = "fast" | "steady" | "slow" | "rest";

export interface FlowState {
  x: number;
  y: number;
  direction: CutDirection;
}

export interface DifficultyFlow {
  starts: [string, number][];
  transitions: Record<string, [string, number][]>;
  doubles: [string, string, number][];
}

export interface FlowTable {
  source: string;
  tiers: Record<Difficulty, DifficultyFlow>;
}

const GAP_LIMITS_SECONDS: readonly (readonly [GapBucket, number])[] = [["fast", 0.3], ["steady", 0.6], ["slow", 1.4]];
const LAST_COLUMN = 3;

const MIRRORED_DIRECTIONS: Record<CutDirection, CutDirection> = {
  up: "up", down: "down", left: "right", right: "left",
  upLeft: "upRight", upRight: "upLeft", downLeft: "downRight", downRight: "downLeft", any: "any",
};

function isCountList(value: unknown, width: number): boolean {
  return Array.isArray(value) && value.every((entry) => Array.isArray(entry) && entry.length === width && typeof entry[width - 1] === "number");
}

function isDifficultyFlow(value: unknown): value is DifficultyFlow {
  if (typeof value !== "object" || value === null) return false;
  const flow = value as Record<string, unknown>;
  const transitions = flow.transitions;
  return isCountList(flow.starts, 2) && isCountList(flow.doubles, 3)
    && typeof transitions === "object" && transitions !== null
    && Object.values(transitions).every((rows) => isCountList(rows, 2));
}

export function readFlowTable(raw: unknown): FlowTable {
  const table = raw as { source?: unknown; tiers?: Record<string, unknown> };
  const missing = DIFFICULTIES.filter((difficulty) => !isDifficultyFlow(table.tiers?.[difficulty]));
  if (typeof table.source !== "string" || missing.length > 0) {
    throw new Error(`the learned flow table is incomplete (missing ${missing.join(", ") || "source"})`);
  }
  return table as FlowTable;
}

export const FLOW_TABLE = readFlowTable(learnedFlow);

export function gapBucket(seconds: number): GapBucket {
  return GAP_LIMITS_SECONDS.find(([, limit]) => seconds < limit)?.[0] ?? "rest";
}

export function toRedFrame(state: FlowState, color: NoteColor): FlowState {
  if (color === "red") return state;
  return { x: LAST_COLUMN - state.x, y: state.y, direction: MIRRORED_DIRECTIONS[state.direction] };
}

export const fromRedFrame = toRedFrame;

export function stateKey(state: FlowState): string {
  return `${state.x}${state.y}${CUT_DIRECTIONS.indexOf(state.direction)}`;
}

export function parseStateKey(key: string): FlowState {
  return { x: Number(key[0]), y: Number(key[1]), direction: CUT_DIRECTIONS[Number(key[2])]! };
}

export function transitionKey(bucket: GapBucket | "any", previous: FlowState): string {
  return `${bucket}|${stateKey(previous)}`;
}

export function noteState(note: Note): FlowState {
  return toRedFrame({ x: note.x, y: note.y, direction: note.direction }, note.color);
}
