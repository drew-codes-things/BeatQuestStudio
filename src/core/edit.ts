import {
  type Arc,
  type Bomb,
  type Chain,
  type Chart,
  type CutDirection,
  GRID_COLUMNS,
  GRID_ROWS,
  type Note,
  type NoteColor,
  type Wall,
} from "./model";

export const BEAT_EPSILON = 1e-3;
export const MAX_WALL_HEIGHT = 5;

export type ChartObject = Note | Bomb | Wall | Arc | Chain;
type Positioned = { id: string; beat: number; x: number; y: number };

export interface ObjectMove {
  beats: number;
  columns: number;
  rows: number;
}

export interface Clipboard {
  notes: Note[];
  bombs: Bomb[];
  walls: Wall[];
  arcs: Arc[];
  chains: Chain[];
}

export type IdFactory = () => string;

const MIRRORED_DIRECTIONS: Record<CutDirection, CutDirection> = {
  up: "up",
  down: "down",
  left: "right",
  right: "left",
  upLeft: "upRight",
  upRight: "upLeft",
  downLeft: "downRight",
  downRight: "downLeft",
  any: "any",
};

function mapEveryKind(chart: Chart, transform: <T extends Positioned>(objects: T[]) => T[]): Chart {
  return {
    notes: transform(chart.notes),
    bombs: transform(chart.bombs),
    walls: transform(chart.walls),
    arcs: transform(chart.arcs),
    chains: transform(chart.chains),
  };
}

function byBeat(left: Positioned, right: Positioned): number {
  return left.beat - right.beat || left.x - right.x || left.y - right.y;
}

export function sortChart(chart: Chart): Chart {
  return mapEveryKind(chart, (objects) => [...objects].sort(byBeat));
}

export function allObjects(chart: Chart): ChartObject[] {
  return [...chart.notes, ...chart.bombs, ...chart.walls, ...chart.arcs, ...chart.chains];
}

export function addNote(chart: Chart, note: Note): Chart {
  return sortChart({ ...chart, notes: [...chart.notes, note] });
}

export function addBomb(chart: Chart, bomb: Bomb): Chart {
  return sortChart({ ...chart, bombs: [...chart.bombs, bomb] });
}

export function addWall(chart: Chart, wall: Wall): Chart {
  return sortChart({ ...chart, walls: [...chart.walls, wall] });
}

export function addArc(chart: Chart, arc: Arc): Chart {
  return sortChart({ ...chart, arcs: [...chart.arcs, arc] });
}

export function addChain(chart: Chart, chain: Chain): Chart {
  return sortChart({ ...chart, chains: [...chart.chains, chain] });
}

export function removeObjects(chart: Chart, ids: ReadonlySet<string>): Chart {
  return mapEveryKind(chart, (objects) => objects.filter((object) => !ids.has(object.id)));
}

function horizontalExtent(object: ChartObject): number[] {
  if ("width" in object) return [object.x, object.x + object.width - 1];
  if ("tailX" in object) return [object.x, object.tailX];
  return [object.x];
}

function verticalExtent(object: ChartObject): number[] {
  if ("height" in object) return [object.y, Math.min(GRID_ROWS - 1, object.y + object.height - 1)];
  if ("tailY" in object) return [object.y, object.tailY];
  return [object.y];
}

function earliestBeat(object: ChartObject): number {
  return object.beat;
}

function canMove(objects: ChartObject[], move: ObjectMove): ObjectMove {
  const columnsFit = objects.every((object) => horizontalExtent(object).every((x) => x + move.columns >= 0 && x + move.columns < GRID_COLUMNS));
  const rowsFit = objects.every((object) => verticalExtent(object).every((y) => y + move.rows >= 0 && y + move.rows < GRID_ROWS));
  const beatsFit = objects.every((object) => earliestBeat(object) + move.beats >= 0);
  return { columns: columnsFit ? move.columns : 0, rows: rowsFit ? move.rows : 0, beats: beatsFit ? move.beats : 0 };
}

function shifted<T extends Positioned>(object: T, move: ObjectMove): T {
  const moved: T = { ...object, beat: object.beat + move.beats, x: object.x + move.columns, y: object.y + move.rows };
  if ("tailBeat" in moved && "tailX" in moved && "tailY" in moved) {
    const tail = moved as T & { tailBeat: number; tailX: number; tailY: number };
    tail.tailBeat += move.beats;
    tail.tailX += move.columns;
    tail.tailY += move.rows;
  }
  return moved;
}

export function moveObjects(chart: Chart, ids: ReadonlySet<string>, requested: ObjectMove): Chart {
  const selected = allObjects(chart).filter((object) => ids.has(object.id));
  const move = canMove(selected, requested);
  if (move.beats === 0 && move.columns === 0 && move.rows === 0) return chart;
  return sortChart(mapEveryKind(chart, (objects) => objects.map((object) => (ids.has(object.id) ? shifted(object, move) : object))));
}

export type RecolorMode = NoteColor | "swap";

function recolored(color: NoteColor, mode: RecolorMode): NoteColor {
  if (mode !== "swap") return mode;
  return color === "red" ? "blue" : "red";
}

export function recolorObjects(chart: Chart, ids: ReadonlySet<string>, mode: RecolorMode): Chart {
  return {
    ...chart,
    notes: chart.notes.map((note) => (ids.has(note.id) ? { ...note, color: recolored(note.color, mode) } : note)),
    arcs: chart.arcs.map((arc) => (ids.has(arc.id) ? { ...arc, color: recolored(arc.color, mode) } : arc)),
    chains: chart.chains.map((chain) => (ids.has(chain.id) ? { ...chain, color: recolored(chain.color, mode) } : chain)),
  };
}

export function setDirection(chart: Chart, ids: ReadonlySet<string>, direction: CutDirection): Chart {
  return {
    ...chart,
    notes: chart.notes.map((note) => (ids.has(note.id) ? { ...note, direction } : note)),
    arcs: chart.arcs.map((arc) => (ids.has(arc.id) ? { ...arc, direction } : arc)),
    chains: chart.chains.map((chain) => (ids.has(chain.id) ? { ...chain, direction } : chain)),
  };
}

export function mirrorColumn(x: number): number {
  return GRID_COLUMNS - 1 - x;
}

export function mirrorDirection(direction: CutDirection): CutDirection {
  return MIRRORED_DIRECTIONS[direction];
}

export function mirrorObjects(chart: Chart, ids: ReadonlySet<string>): Chart {
  const flipColor = (color: NoteColor): NoteColor => (color === "red" ? "blue" : "red");
  return sortChart({
    notes: chart.notes.map((note) => ids.has(note.id) ? { ...note, x: mirrorColumn(note.x), color: flipColor(note.color), direction: mirrorDirection(note.direction) } : note),
    bombs: chart.bombs.map((bomb) => ids.has(bomb.id) ? { ...bomb, x: mirrorColumn(bomb.x) } : bomb),
    walls: chart.walls.map((wall) => ids.has(wall.id) ? { ...wall, x: GRID_COLUMNS - wall.x - wall.width } : wall),
    arcs: chart.arcs.map((arc) => ids.has(arc.id) ? {
      ...arc, x: mirrorColumn(arc.x), tailX: mirrorColumn(arc.tailX), color: flipColor(arc.color),
      direction: mirrorDirection(arc.direction), tailDirection: mirrorDirection(arc.tailDirection),
    } : arc),
    chains: chart.chains.map((chain) => ids.has(chain.id) ? {
      ...chain, x: mirrorColumn(chain.x), tailX: mirrorColumn(chain.tailX), color: flipColor(chain.color), direction: mirrorDirection(chain.direction),
    } : chain),
  });
}

export function copySelection(chart: Chart, ids: ReadonlySet<string>): Clipboard | null {
  const selected = allObjects(chart).filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;
  const firstBeat = Math.min(...selected.map((object) => object.beat));
  const toOrigin = { beats: -firstBeat, columns: 0, rows: 0 };
  const pick = <T extends Positioned>(objects: T[]) => objects.filter((object) => ids.has(object.id)).map((object) => shifted(structuredClone(object), toOrigin));
  return { notes: pick(chart.notes), bombs: pick(chart.bombs), walls: pick(chart.walls), arcs: pick(chart.arcs), chains: pick(chart.chains) };
}

export interface PasteResult {
  chart: Chart;
  ids: Set<string>;
}

export function pasteClipboard(chart: Chart, clipboard: Clipboard, atBeat: number, makeId: IdFactory): PasteResult {
  const ids = new Set<string>();
  const toCursor = { beats: atBeat, columns: 0, rows: 0 };
  const place = <T extends Positioned>(objects: T[]) => objects.map((object) => {
    const id = makeId();
    ids.add(id);
    return { ...shifted(object, toCursor), id };
  });
  const pasted = sortChart({
    notes: [...chart.notes, ...place(clipboard.notes)],
    bombs: [...chart.bombs, ...place(clipboard.bombs)],
    walls: [...chart.walls, ...place(clipboard.walls)],
    arcs: [...chart.arcs, ...place(clipboard.arcs)],
    chains: [...chart.chains, ...place(clipboard.chains)],
  });
  return { chart: pasted, ids };
}

export function copyToChart(source: Chart, ids: ReadonlySet<string>, target: Chart, makeId: IdFactory): PasteResult {
  const clipboard = copySelection(source, ids);
  if (!clipboard) return { chart: target, ids: new Set() };
  const firstBeat = Math.min(...allObjects(source).filter((object) => ids.has(object.id)).map((object) => object.beat));
  return pasteClipboard(target, clipboard, firstBeat, makeId);
}

export function objectEndBeat(object: ChartObject): number {
  if ("durationBeats" in object) return object.beat + object.durationBeats;
  if ("tailBeat" in object) return object.tailBeat;
  return object.beat;
}

export function idsInBeatRange(chart: Chart, fromBeat: number, toBeat: number): Set<string> {
  const low = Math.min(fromBeat, toBeat) - BEAT_EPSILON;
  const high = Math.max(fromBeat, toBeat) + BEAT_EPSILON;
  return new Set(allObjects(chart).filter((object) => object.beat >= low && object.beat <= high).map((object) => object.id));
}

export function sameBeat(left: number, right: number): boolean {
  return Math.abs(left - right) < BEAT_EPSILON;
}

export function objectsAtBeat(chart: Chart, beat: number): ChartObject[] {
  return allObjects(chart).filter((object) => sameBeat(object.beat, beat));
}

export function findObjectAt(chart: Chart, beat: number, x: number, y: number): ChartObject | undefined {
  return objectsAtBeat(chart, beat).find((object) => object.x === x && object.y === y);
}
