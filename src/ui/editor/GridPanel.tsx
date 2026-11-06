import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { BEAT_EPSILON } from "../../core/edit";
import { type Chart, type CutDirection, GRID_COLUMNS, GRID_ROWS } from "../../core/model";
import { arrowRotationDegrees, type Cell, directionFromDrag } from "./geometry";
import { COLORS, drawArrow } from "./timelineDraw";

const CELL_SIZE = 76;
const LOOKAHEAD_BEATS = 2;
const PANEL_WIDTH = CELL_SIZE * GRID_COLUMNS;
const PANEL_HEIGHT = CELL_SIZE * GRID_ROWS;

interface GridPanelProps {
  chart: Chart;
  beat: number;
  selection: ReadonlySet<string>;
  onCellClick: (cell: Cell, direction: CutDirection | null, additive: boolean) => void;
  onCellDelete: (cell: Cell) => void;
}

function cellAt(x: number, y: number): Cell {
  return {
    x: Math.max(0, Math.min(GRID_COLUMNS - 1, Math.floor(x / CELL_SIZE))),
    y: Math.max(0, Math.min(GRID_ROWS - 1, GRID_ROWS - 1 - Math.floor(y / CELL_SIZE))),
  };
}

function cellOrigin(cell: Cell): { left: number; top: number } {
  return { left: cell.x * CELL_SIZE, top: (GRID_ROWS - 1 - cell.y) * CELL_SIZE };
}

function drawGrid(context: CanvasRenderingContext2D, props: GridPanelProps): void {
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
  context.strokeStyle = "rgba(255,255,255,0.12)";
  for (let column = 0; column <= GRID_COLUMNS; column += 1) {
    context.beginPath();
    context.moveTo(column * CELL_SIZE + 0.5, 0);
    context.lineTo(column * CELL_SIZE + 0.5, PANEL_HEIGHT);
    context.stroke();
  }
  for (let row = 0; row <= GRID_ROWS; row += 1) {
    context.beginPath();
    context.moveTo(0, row * CELL_SIZE + 0.5);
    context.lineTo(PANEL_WIDTH, row * CELL_SIZE + 0.5);
    context.stroke();
  }
  for (const wall of props.chart.walls) {
    if (props.beat < wall.beat - BEAT_EPSILON || props.beat > wall.beat + wall.durationBeats + BEAT_EPSILON) continue;
    const top = cellOrigin({ x: wall.x, y: Math.min(GRID_ROWS - 1, wall.y + wall.height - 1) }).top;
    const bottom = cellOrigin({ x: wall.x, y: wall.y }).top + CELL_SIZE;
    context.fillStyle = COLORS.wall;
    context.fillRect(wall.x * CELL_SIZE, top, wall.width * CELL_SIZE, bottom - top);
  }
  const items = [
    ...props.chart.notes.map((note) => ({ id: note.id, beat: note.beat, x: note.x, y: note.y, note })),
    ...props.chart.bombs.map((bomb) => ({ id: bomb.id, beat: bomb.beat, x: bomb.x, y: bomb.y, note: null })),
  ];
  const upcoming = items
    .filter((object) => object.beat > props.beat + BEAT_EPSILON && object.beat <= props.beat + LOOKAHEAD_BEATS)
    .sort((left, right) => right.beat - left.beat);
  const current = items.filter((object) => Math.abs(object.beat - props.beat) < BEAT_EPSILON);
  for (const object of [...upcoming, ...current]) {
    const isCurrent = current.includes(object);
    const distance = isCurrent ? 0 : (object.beat - props.beat) / LOOKAHEAD_BEATS;
    const size = CELL_SIZE * (isCurrent ? 0.7 : 0.55 - 0.25 * distance);
    const { left, top } = cellOrigin(object);
    const centreX = left + CELL_SIZE / 2;
    const centreY = top + CELL_SIZE / 2;
    context.globalAlpha = isCurrent ? 1 : 0.45 - 0.3 * distance;
    if (object.note) {
      context.fillStyle = object.note.color === "red" ? COLORS.red : COLORS.blue;
      context.fillRect(centreX - size / 2, centreY - size / 2, size, size);
      drawArrow(context, centreX, centreY, size, arrowRotationDegrees(object.note.direction));
    } else {
      context.fillStyle = COLORS.bomb;
      context.strokeStyle = COLORS.bombRing;
      context.beginPath();
      context.arc(centreX, centreY, size / 2, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    if (isCurrent && props.selection.has(object.id)) {
      context.strokeStyle = COLORS.selection;
      context.lineWidth = 3;
      context.strokeRect(centreX - size / 2 - 3, centreY - size / 2 - 3, size + 6, size + 6);
      context.lineWidth = 1;
    }
  }
  context.globalAlpha = 1;
}

export function GridPanel(props: GridPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pressed, setPressed] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = PANEL_WIDTH * ratio;
    canvas.height = PANEL_HEIGHT * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawGrid(context, props);
  });

  const position = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  return (
    <canvas
      ref={canvasRef}
      className="grid-panel"
      data-testid="grid-panel"
      style={{ width: `${PANEL_WIDTH}px`, height: `${PANEL_HEIGHT}px` }}
      onContextMenu={(event) => {
        event.preventDefault();
        const { x, y } = position(event);
        props.onCellDelete(cellAt(x, y));
      }}
      onMouseDown={(event) => {
        if (event.button === 0) setPressed(position(event));
      }}
      onMouseUp={(event) => {
        if (!pressed || event.button !== 0) return;
        const { x, y } = position(event);
        props.onCellClick(cellAt(pressed.x, pressed.y), directionFromDrag(x - pressed.x, y - pressed.y), event.shiftKey);
        setPressed(null);
      }}
      onMouseLeave={() => setPressed(null)}
    />
  );
}
