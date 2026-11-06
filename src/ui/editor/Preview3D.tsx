import { useEffect, useRef } from "react";
import { type Chart, GRID_COLUMNS, GRID_ROWS } from "../../core/model";
import { arrowRotationDegrees } from "./geometry";
import { COLORS, drawArrow } from "./timelineDraw";

const WIDTH = 360;
const HEIGHT = 260;
const VIEW_BEATS = 4;
const DEPTH_PER_BEAT = 1;
const FOCAL = 1.6;
const NEAR_DEPTH = 0.4;
const CELL_UNITS = 0.6;
const HORIZON_Y = HEIGHT * 0.32;
const FLOOR_Y = HEIGHT * 0.95;

interface Preview3DProps {
  chart: Chart;
  beat: number;
}

interface Projected {
  x: number;
  y: number;
  scale: number;
}

function project(column: number, row: number, depth: number): Projected {
  const scale = FOCAL / (FOCAL + depth);
  const worldX = (column - (GRID_COLUMNS - 1) / 2) * CELL_UNITS;
  const worldY = row * CELL_UNITS;
  return {
    x: WIDTH / 2 + worldX * scale * (WIDTH / 2.2),
    y: FLOOR_Y - (FLOOR_Y - HORIZON_Y) * (1 - scale) - worldY * scale * (HEIGHT / 3.2),
    scale,
  };
}

function depthOf(beat: number, now: number): number {
  return (beat - now) * DEPTH_PER_BEAT + NEAR_DEPTH;
}

function drawFloor(context: CanvasRenderingContext2D): void {
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = "rgba(255,255,255,0.08)";
  for (let column = 0; column <= GRID_COLUMNS; column += 1) {
    const near = project(column - 0.5, -0.5, NEAR_DEPTH);
    const far = project(column - 0.5, -0.5, VIEW_BEATS * DEPTH_PER_BEAT + NEAR_DEPTH);
    context.beginPath();
    context.moveTo(near.x, near.y);
    context.lineTo(far.x, far.y);
    context.stroke();
  }
}

function drawScene(context: CanvasRenderingContext2D, { chart, beat }: Preview3DProps): void {
  drawFloor(context);
  const inView = (start: number) => start >= beat - 0.05 && start <= beat + VIEW_BEATS;
  for (const wall of chart.walls) {
    const start = Math.max(beat, wall.beat);
    const end = Math.min(beat + VIEW_BEATS, wall.beat + wall.durationBeats);
    if (end <= start) continue;
    const near = depthOf(start, beat);
    const far = depthOf(end, beat);
    const topRow = Math.min(GRID_ROWS, wall.y + wall.height) - 0.5;
    const corners = [project(wall.x - 0.5, wall.y - 0.5, near), project(wall.x + wall.width - 0.5, topRow, near), project(wall.x - 0.5, wall.y - 0.5, far), project(wall.x + wall.width - 0.5, topRow, far)];
    context.fillStyle = COLORS.wall;
    context.fillRect(corners[2]!.x, corners[3]!.y, corners[3]!.x - corners[2]!.x, corners[2]!.y - corners[3]!.y);
    context.fillRect(corners[0]!.x, corners[1]!.y, corners[1]!.x - corners[0]!.x, corners[0]!.y - corners[1]!.y);
  }
  for (const slider of [...chart.arcs, ...chart.chains]) {
    if (!inView(slider.beat) && !inView(slider.tailBeat)) continue;
    const head = project(slider.x, slider.y, depthOf(Math.max(beat, slider.beat), beat));
    const tail = project(slider.tailX, slider.tailY, depthOf(Math.min(beat + VIEW_BEATS, slider.tailBeat), beat));
    context.strokeStyle = slider.color === "red" ? COLORS.red : COLORS.blue;
    context.lineWidth = 3 * head.scale;
    context.beginPath();
    context.moveTo(head.x, head.y);
    context.lineTo(tail.x, tail.y);
    context.stroke();
  }
  context.lineWidth = 1;
  const items = [
    ...chart.notes.map((note) => ({ beat: note.beat, x: note.x, y: note.y, note })),
    ...chart.bombs.map((bomb) => ({ beat: bomb.beat, x: bomb.x, y: bomb.y, note: null })),
  ];
  const objects = items.filter((object) => inView(object.beat)).sort((left, right) => right.beat - left.beat);
  for (const object of objects) {
    const point = project(object.x, object.y, depthOf(object.beat, beat));
    const size = 46 * point.scale;
    context.globalAlpha = Math.min(1, 0.35 + point.scale);
    if (object.note) {
      context.fillStyle = object.note.color === "red" ? COLORS.red : COLORS.blue;
      context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
      drawArrow(context, point.x, point.y, size, arrowRotationDegrees(object.note.direction));
    } else {
      context.fillStyle = COLORS.bomb;
      context.strokeStyle = COLORS.bombRing;
      context.beginPath();
      context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

export function Preview3D(props: Preview3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawScene(context, props);
  });
  return <canvas ref={canvasRef} className="preview-3d" data-testid="preview-3d" style={{ width: `${WIDTH}px`, height: `${HEIGHT}px` }} />;
}
