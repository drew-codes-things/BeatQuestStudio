import { type CutDirection, GRID_COLUMNS, GRID_ROWS } from "../../core/model";

export const LANE_COUNT = GRID_COLUMNS * GRID_ROWS;
export const LANE_HEIGHT = 18;
export const WAVEFORM_HEIGHT = 64;
export const RULER_HEIGHT = 20;
export const LANES_TOP = WAVEFORM_HEIGHT + RULER_HEIGHT;
export const TIMELINE_HEIGHT = LANES_TOP + LANE_COUNT * LANE_HEIGHT + 8;
export const LABEL_WIDTH = 44;
export const MIN_PIXELS_PER_BEAT = 12;
export const MAX_PIXELS_PER_BEAT = 640;
export const SNAP_DIVISIONS = [1, 2, 3, 4, 6, 8, 12, 16] as const;

export interface Viewport {
  leftBeat: number;
  pixelsPerBeat: number;
}

export interface Cell {
  x: number;
  y: number;
}

export function laneOf(cell: Cell): number {
  return (GRID_ROWS - 1 - cell.y) * GRID_COLUMNS + cell.x;
}

export function cellOfLane(lane: number): Cell {
  const clamped = Math.max(0, Math.min(LANE_COUNT - 1, lane));
  return { x: clamped % GRID_COLUMNS, y: GRID_ROWS - 1 - Math.floor(clamped / GRID_COLUMNS) };
}

export function laneTop(lane: number): number {
  return LANES_TOP + lane * LANE_HEIGHT;
}

export function laneAtY(y: number): number | null {
  const lane = Math.floor((y - LANES_TOP) / LANE_HEIGHT);
  return lane >= 0 && lane < LANE_COUNT ? lane : null;
}

export function beatToX(beat: number, viewport: Viewport): number {
  return LABEL_WIDTH + (beat - viewport.leftBeat) * viewport.pixelsPerBeat;
}

export function xToBeat(x: number, viewport: Viewport): number {
  return viewport.leftBeat + (x - LABEL_WIDTH) / viewport.pixelsPerBeat;
}

export function zoomAround(viewport: Viewport, anchorX: number, factor: number): Viewport {
  const anchorBeat = xToBeat(anchorX, viewport);
  const pixelsPerBeat = Math.max(MIN_PIXELS_PER_BEAT, Math.min(MAX_PIXELS_PER_BEAT, viewport.pixelsPerBeat * factor));
  return { pixelsPerBeat, leftBeat: anchorBeat - (anchorX - LABEL_WIDTH) / pixelsPerBeat };
}

export const LAYER_NAMES = ["Bottom", "Middle", "Top"] as const;

export function laneLabel(lane: number): string {
  const cell = cellOfLane(lane);
  return `${LAYER_NAMES[cell.y]!.charAt(0)}${cell.x + 1}`;
}

const DIRECTION_ANGLES: Record<Exclude<CutDirection, "any">, number> = {
  down: 0,
  downLeft: 45,
  left: 90,
  upLeft: 135,
  up: 180,
  upRight: 225,
  right: 270,
  downRight: 315,
};

export function arrowRotationDegrees(direction: CutDirection): number | null {
  return direction === "any" ? null : DIRECTION_ANGLES[direction];
}

const DRAG_DIRECTIONS: CutDirection[] = ["right", "downRight", "down", "downLeft", "left", "upLeft", "up", "upRight"];
const MIN_DRAG_PIXELS = 12;

export function directionFromDrag(deltaX: number, deltaY: number): CutDirection | null {
  if (Math.hypot(deltaX, deltaY) < MIN_DRAG_PIXELS) return null;
  const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
  const sector = Math.round(((angle + 360) % 360) / 45) % 8;
  return DRAG_DIRECTIONS[sector]!;
}
