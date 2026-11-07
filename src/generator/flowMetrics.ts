import type { CutDirection, Note, NoteColor } from "../core/model";

export type SwingKind = "down" | "up" | "side" | "dot";

export const SAME_SWING_BEATS = 0.126;

const SWING_KINDS: Record<CutDirection, SwingKind> = {
  down: "down",
  downLeft: "down",
  downRight: "down",
  up: "up",
  upLeft: "up",
  upRight: "up",
  left: "side",
  right: "side",
  any: "dot",
};

const DIAGONALS: ReadonlySet<CutDirection> = new Set(["downLeft", "downRight", "upLeft", "upRight"]);

export interface FlowMetrics {
  notesPerSecond: number;
  parityFlipRate: number;
  downOnBottomShare: number;
  upAboveBottomShare: number;
  doubleShare: number;
  diagonalShare: number;
  dotShare: number;
  rowShares: [number, number, number];
}

export function swingKind(direction: CutDirection): SwingKind {
  return SWING_KINDS[direction];
}

export function handSwings(notes: readonly Note[], color: NoteColor): Note[] {
  const swings: Note[] = [];
  for (const note of [...notes].sort((left, right) => left.beat - right.beat)) {
    if (note.color !== color) continue;
    const previous = swings[swings.length - 1];
    if (previous && note.beat - previous.beat < SAME_SWING_BEATS) continue;
    swings.push(note);
  }
  return swings;
}

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function parityFlips(notes: readonly Note[]): { flips: number; pairs: number } {
  let flips = 0;
  let pairs = 0;
  for (const color of ["red", "blue"] as const) {
    const swings = handSwings(notes, color);
    for (let index = 1; index < swings.length; index += 1) {
      const before = swingKind(swings[index - 1]!.direction);
      const after = swingKind(swings[index]!.direction);
      const vertical = (kind: SwingKind) => kind === "down" || kind === "up";
      if (!vertical(before) || !vertical(after)) continue;
      pairs += 1;
      if (before !== after) flips += 1;
    }
  }
  return { flips, pairs };
}

function doubleShare(notes: readonly Note[]): number {
  const colorsAtBeat = new Map<number, Set<NoteColor>>();
  for (const note of notes) {
    const key = Math.round(note.beat * 48);
    const colors = colorsAtBeat.get(key) ?? new Set<NoteColor>();
    colors.add(note.color);
    colorsAtBeat.set(key, colors);
  }
  const doubles = [...colorsAtBeat.values()].filter((colors) => colors.size === 2).length;
  return share(doubles, colorsAtBeat.size);
}

export function measureFlow(notes: readonly Note[], durationSeconds: number): FlowMetrics {
  const downs = notes.filter((note) => swingKind(note.direction) === "down");
  const ups = notes.filter((note) => swingKind(note.direction) === "up");
  const { flips, pairs } = parityFlips(notes);
  const rowCount = (row: number) => share(notes.filter((note) => note.y === row).length, notes.length);
  return {
    notesPerSecond: share(notes.length, durationSeconds),
    parityFlipRate: share(flips, pairs),
    downOnBottomShare: share(downs.filter((note) => note.y === 0).length, downs.length),
    upAboveBottomShare: share(ups.filter((note) => note.y > 0).length, ups.length),
    doubleShare: doubleShare(notes),
    diagonalShare: share(notes.filter((note) => DIAGONALS.has(note.direction)).length, notes.length),
    dotShare: share(notes.filter((note) => note.direction === "any").length, notes.length),
    rowShares: [rowCount(0), rowCount(1), rowCount(2)],
  };
}
