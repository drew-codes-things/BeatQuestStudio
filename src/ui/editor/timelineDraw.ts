import type { WaveformPeaks } from "../../audio/analysis";
import { allObjects, type ChartObject, objectEndBeat } from "../../core/edit";
import { type Chart, GRID_COLUMNS, GRID_ROWS, type Timing } from "../../core/model";
import { beatToSeconds } from "../../core/timing";
import {
  arrowRotationDegrees,
  beatToX,
  type Cell,
  LABEL_WIDTH,
  LANE_COUNT,
  LANE_HEIGHT,
  laneLabel,
  laneOf,
  LANES_TOP,
  laneTop,
  RULER_HEIGHT,
  type Viewport,
  WAVEFORM_HEIGHT,
  xToBeat,
} from "./geometry";

export const COLORS = {
  background: "#0d0e12",
  band: "#14161d",
  bandAlt: "#181b23",
  label: "#8a90a2",
  barLine: "rgba(255,255,255,0.28)",
  beatLine: "rgba(255,255,255,0.12)",
  snapLine: "rgba(255,255,255,0.05)",
  waveform: "rgba(160,170,200,0.55)",
  red: "#ff3b4e",
  blue: "#3b8bff",
  bomb: "#2b2b33",
  bombRing: "#9aa0b4",
  wall: "rgba(255,90,120,0.28)",
  wallEdge: "rgba(255,90,120,0.7)",
  selection: "#ffffff",
  cursor: "#fbbf24",
  playhead: "#4ade80",
  marquee: "rgba(59,139,255,0.18)",
} as const;

const BEATS_PER_BAR = 4;
const NOTE_SIZE = 14;
const MIN_SNAP_LINE_SPACING = 8;

export interface DragPreview {
  ids: ReadonlySet<string>;
  beats: number;
  columns: number;
  rows: number;
}

export interface Marquee {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TimelineScene {
  width: number;
  chart: Chart;
  selection: ReadonlySet<string>;
  cursorBeat: number;
  playheadBeat: number | null;
  viewport: Viewport;
  timing: Timing;
  peaks: WaveformPeaks | null;
  snap: number;
  dragPreview: DragPreview | null;
  marquee: Marquee | null;
  wallPreview: { fromBeat: number; toBeat: number; column: number; width: number } | null;
}

function shiftedCell(object: { x: number; y: number }, preview: DragPreview | null, id: string): Cell {
  if (!preview || !preview.ids.has(id)) return { x: object.x, y: object.y };
  return { x: object.x + preview.columns, y: object.y + preview.rows };
}

function shiftedBeat(beat: number, preview: DragPreview | null, id: string): number {
  return preview && preview.ids.has(id) ? beat + preview.beats : beat;
}

function drawLanes(context: CanvasRenderingContext2D, width: number): void {
  for (let lane = 0; lane < LANE_COUNT; lane += 1) {
    const band = Math.floor(lane / GRID_COLUMNS);
    context.fillStyle = band % 2 === 0 ? COLORS.band : COLORS.bandAlt;
    context.fillRect(0, laneTop(lane), width, LANE_HEIGHT);
    context.fillStyle = COLORS.label;
    context.font = "10px system-ui, sans-serif";
    context.textBaseline = "middle";
    context.fillText(laneLabel(lane), 8, laneTop(lane) + LANE_HEIGHT / 2);
  }
}

function drawWaveform(context: CanvasRenderingContext2D, scene: TimelineScene): void {
  const peaks = scene.peaks;
  if (!peaks) return;
  const middle = WAVEFORM_HEIGHT / 2;
  context.fillStyle = COLORS.waveform;
  const secondsPerBucket = peaks.samplesPerBucket / peaks.sampleRate;
  for (let x = LABEL_WIDTH; x < scene.width; x += 1) {
    const fromSeconds = beatToSeconds(xToBeat(x, scene.viewport), scene.timing);
    const toSeconds = beatToSeconds(xToBeat(x + 1, scene.viewport), scene.timing);
    const first = Math.max(0, Math.floor(fromSeconds / secondsPerBucket));
    const last = Math.min(peaks.min.length - 1, Math.ceil(toSeconds / secondsPerBucket));
    if (last < 0 || first >= peaks.min.length) continue;
    let low = 0;
    let high = 0;
    for (let bucket = first; bucket <= last; bucket += 1) {
      low = Math.min(low, peaks.min[bucket]!);
      high = Math.max(high, peaks.max[bucket]!);
    }
    context.fillRect(x, middle - high * middle, 1, Math.max(1, (high - low) * middle));
  }
}

function drawBeatLines(context: CanvasRenderingContext2D, scene: TimelineScene): void {
  const { viewport } = scene;
  const firstBeat = Math.floor(xToBeat(LABEL_WIDTH, viewport));
  const lastBeat = Math.ceil(xToBeat(scene.width, viewport));
  const bottom = laneTop(LANE_COUNT);
  const showSnap = viewport.pixelsPerBeat / scene.snap >= MIN_SNAP_LINE_SPACING;
  context.font = "10px system-ui, sans-serif";
  context.textBaseline = "middle";
  for (let beat = Math.max(0, firstBeat); beat <= lastBeat; beat += 1) {
    const x = Math.round(beatToX(beat, viewport)) + 0.5;
    const isBar = beat % BEATS_PER_BAR === 0;
    context.strokeStyle = isBar ? COLORS.barLine : COLORS.beatLine;
    context.beginPath();
    context.moveTo(x, WAVEFORM_HEIGHT);
    context.lineTo(x, bottom);
    context.stroke();
    if (isBar || viewport.pixelsPerBeat > 36) {
      context.fillStyle = isBar ? "#e8eaf0" : COLORS.label;
      context.fillText(`${beat}`, x + 3, WAVEFORM_HEIGHT + RULER_HEIGHT / 2);
    }
    if (!showSnap) continue;
    context.strokeStyle = COLORS.snapLine;
    for (let part = 1; part < scene.snap; part += 1) {
      const snapX = Math.round(beatToX(beat + part / scene.snap, viewport)) + 0.5;
      context.beginPath();
      context.moveTo(snapX, LANES_TOP);
      context.lineTo(snapX, bottom);
      context.stroke();
    }
  }
}

function lanesOfWall(wall: { x: number; y: number; width: number; height: number }, cell: Cell): number[] {
  const lanes: number[] = [];
  for (let row = Math.max(0, cell.y); row < Math.min(GRID_ROWS, cell.y + wall.height); row += 1) {
    for (let column = Math.max(0, cell.x); column < Math.min(GRID_COLUMNS, cell.x + wall.width); column += 1) lanes.push(laneOf({ x: column, y: row }));
  }
  return lanes;
}

function drawWalls(context: CanvasRenderingContext2D, scene: TimelineScene): void {
  for (const wall of scene.chart.walls) {
    const beat = shiftedBeat(wall.beat, scene.dragPreview, wall.id);
    const cell = shiftedCell(wall, scene.dragPreview, wall.id);
    const left = beatToX(beat, scene.viewport);
    const right = beatToX(beat + wall.durationBeats, scene.viewport);
    if (right < LABEL_WIDTH || left > scene.width) continue;
    for (const lane of lanesOfWall(wall, cell)) {
      context.fillStyle = COLORS.wall;
      context.fillRect(left, laneTop(lane) + 1, right - left, LANE_HEIGHT - 2);
      context.strokeStyle = scene.selection.has(wall.id) ? COLORS.selection : COLORS.wallEdge;
      context.strokeRect(left + 0.5, laneTop(lane) + 1.5, right - left - 1, LANE_HEIGHT - 3);
    }
  }
  const preview = scene.wallPreview;
  if (!preview) return;
  const left = beatToX(Math.min(preview.fromBeat, preview.toBeat), scene.viewport);
  const right = beatToX(Math.max(preview.fromBeat, preview.toBeat), scene.viewport);
  context.fillStyle = COLORS.wall;
  for (let column = preview.column; column < Math.min(GRID_COLUMNS, preview.column + preview.width); column += 1) {
    for (let row = 0; row < GRID_ROWS; row += 1) context.fillRect(left, laneTop(laneOf({ x: column, y: row })) + 1, right - left, LANE_HEIGHT - 2);
  }
}

function laneCentre(cell: Cell): number {
  return laneTop(laneOf(cell)) + LANE_HEIGHT / 2;
}

function drawSliders(context: CanvasRenderingContext2D, scene: TimelineScene): void {
  const sliders = [...scene.chart.arcs.map((arc) => ({ ...arc, dashed: false })), ...scene.chart.chains.map((chain) => ({ ...chain, dashed: true }))];
  for (const slider of sliders) {
    const headBeat = shiftedBeat(slider.beat, scene.dragPreview, slider.id);
    const tailBeat = shiftedBeat(slider.tailBeat, scene.dragPreview, slider.id);
    const head = shiftedCell(slider, scene.dragPreview, slider.id);
    const tail = shiftedCell({ x: slider.tailX, y: slider.tailY }, scene.dragPreview, slider.id);
    context.strokeStyle = slider.color === "red" ? COLORS.red : COLORS.blue;
    context.lineWidth = scene.selection.has(slider.id) ? 4 : 2.5;
    context.setLineDash(slider.dashed ? [4, 3] : []);
    context.beginPath();
    context.moveTo(beatToX(headBeat, scene.viewport), laneCentre(head));
    context.lineTo(beatToX(tailBeat, scene.viewport), laneCentre(tail));
    context.stroke();
  }
  context.setLineDash([]);
  context.lineWidth = 1;
}

export function drawArrow(context: CanvasRenderingContext2D, centreX: number, centreY: number, size: number, rotation: number | null): void {
  context.fillStyle = "#ffffff";
  if (rotation === null) {
    context.beginPath();
    context.arc(centreX, centreY, size * 0.16, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.save();
  context.translate(centreX, centreY);
  context.rotate((rotation * Math.PI) / 180);
  context.beginPath();
  context.moveTo(-size * 0.32, -size * 0.08);
  context.lineTo(size * 0.32, -size * 0.08);
  context.lineTo(0, size * 0.3);
  context.closePath();
  context.fill();
  context.restore();
}

function drawNotesAndBombs(context: CanvasRenderingContext2D, scene: TimelineScene): void {
  const visible = (x: number) => x > LABEL_WIDTH - NOTE_SIZE && x < scene.width + NOTE_SIZE;
  for (const bomb of scene.chart.bombs) {
    const x = beatToX(shiftedBeat(bomb.beat, scene.dragPreview, bomb.id), scene.viewport);
    if (!visible(x)) continue;
    const y = laneCentre(shiftedCell(bomb, scene.dragPreview, bomb.id));
    context.fillStyle = COLORS.bomb;
    context.strokeStyle = scene.selection.has(bomb.id) ? COLORS.selection : COLORS.bombRing;
    context.lineWidth = scene.selection.has(bomb.id) ? 2 : 1;
    context.beginPath();
    context.arc(x, y, NOTE_SIZE / 2 - 1, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  for (const note of scene.chart.notes) {
    const x = beatToX(shiftedBeat(note.beat, scene.dragPreview, note.id), scene.viewport);
    if (!visible(x)) continue;
    const y = laneCentre(shiftedCell(note, scene.dragPreview, note.id));
    context.fillStyle = note.color === "red" ? COLORS.red : COLORS.blue;
    context.fillRect(x - NOTE_SIZE / 2, y - NOTE_SIZE / 2, NOTE_SIZE, NOTE_SIZE);
    if (scene.selection.has(note.id)) {
      context.strokeStyle = COLORS.selection;
      context.lineWidth = 2;
      context.strokeRect(x - NOTE_SIZE / 2 - 1, y - NOTE_SIZE / 2 - 1, NOTE_SIZE + 2, NOTE_SIZE + 2);
    }
    drawArrow(context, x, y, NOTE_SIZE, arrowRotationDegrees(note.direction));
  }
  context.lineWidth = 1;
}

function drawLine(context: CanvasRenderingContext2D, x: number, color: string, top: number, bottom: number): void {
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, top);
  context.lineTo(x, bottom);
  context.stroke();
  context.lineWidth = 1;
}

export function drawTimeline(context: CanvasRenderingContext2D, scene: TimelineScene, height: number): void {
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, scene.width, height);
  drawLanes(context, scene.width);
  drawWaveform(context, scene);
  drawBeatLines(context, scene);
  drawWalls(context, scene);
  drawSliders(context, scene);
  drawNotesAndBombs(context, scene);
  drawLine(context, beatToX(scene.cursorBeat, scene.viewport), COLORS.cursor, 0, height);
  if (scene.playheadBeat !== null) drawLine(context, beatToX(scene.playheadBeat, scene.viewport), COLORS.playhead, 0, height);
  if (scene.marquee) {
    const { x1, y1, x2, y2 } = scene.marquee;
    context.fillStyle = COLORS.marquee;
    context.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  }
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, LABEL_WIDTH - 2, WAVEFORM_HEIGHT + RULER_HEIGHT);
}

function hitBox(object: ChartObject, viewport: Viewport): { left: number; right: number; lanes: number[] } {
  const x = beatToX(object.beat, viewport);
  if ("durationBeats" in object) return { left: x, right: beatToX(objectEndBeat(object), viewport), lanes: lanesOfWall(object, object) };
  return { left: x - NOTE_SIZE / 2, right: x + NOTE_SIZE / 2, lanes: [laneOf(object)] };
}

export function objectAtPoint(chart: Chart, x: number, y: number, viewport: Viewport): ChartObject | null {
  const lane = Math.floor((y - LANES_TOP) / LANE_HEIGHT);
  const candidates = allObjects(chart).reverse();
  const pointHit = candidates.find((object) => !("durationBeats" in object) && hitBox(object, viewport).lanes.includes(lane) && x >= hitBox(object, viewport).left && x <= hitBox(object, viewport).right);
  if (pointHit) return pointHit;
  return candidates.find((object) => "durationBeats" in object && hitBox(object, viewport).lanes.includes(lane) && x >= hitBox(object, viewport).left && x <= hitBox(object, viewport).right) ?? null;
}

export function objectsInMarquee(chart: Chart, marquee: Marquee, viewport: Viewport): Set<string> {
  const left = Math.min(marquee.x1, marquee.x2);
  const right = Math.max(marquee.x1, marquee.x2);
  const top = Math.min(marquee.y1, marquee.y2);
  const bottom = Math.max(marquee.y1, marquee.y2);
  const ids = new Set<string>();
  for (const object of allObjects(chart)) {
    const x = beatToX(object.beat, viewport);
    const y = laneCentre(object);
    if (x >= left && x <= right && y >= top && y <= bottom) ids.add(object.id);
  }
  return ids;
}
