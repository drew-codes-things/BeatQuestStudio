import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import type { WaveformPeaks } from "../../audio/analysis";
import type { ObjectMove } from "../../core/edit";
import { type Chart, GRID_COLUMNS, type Timing } from "../../core/model";
import { snapBeat } from "../../core/timing";
import { type Cell, cellOfLane, laneAtY, laneOf, LANES_TOP, LANE_HEIGHT, TIMELINE_HEIGHT, type Viewport, xToBeat, zoomAround } from "./geometry";
import type { PlacementSettings } from "./placement";
import { type DragPreview, drawTimeline, type Marquee, objectAtPoint, objectsInMarquee } from "./timelineDraw";

export type SelectMode = "replace" | "toggle" | "add";

interface TimelineProps {
  chart: Chart;
  selection: ReadonlySet<string>;
  cursorBeat: number;
  playheadBeat: number | null;
  viewport: Viewport;
  timing: Timing;
  peaks: WaveformPeaks | null;
  snap: number;
  settings: PlacementSettings;
  onViewportChange: (viewport: Viewport) => void;
  onCursor: (beat: number) => void;
  onSelect: (ids: Set<string>, mode: SelectMode) => void;
  onPlace: (beat: number, cell: Cell) => void;
  onPlaceWall: (fromBeat: number, toBeat: number, column: number) => void;
  onMove: (ids: ReadonlySet<string>, move: ObjectMove) => void;
  onDelete: (ids: Set<string>) => void;
}

type Drag =
  | { kind: "seek" }
  | { kind: "move"; startX: number; startY: number; anchorLane: number; ids: ReadonlySet<string> }
  | { kind: "marquee"; startX: number; startY: number; additive: boolean }
  | { kind: "wall"; fromBeat: number; column: number }
  | { kind: "pending"; startX: number; startY: number; beat: number; cell: Cell | null };

const DRAG_THRESHOLD_PIXELS = 4;
const WHEEL_ZOOM_STEP = 1.15;

function pointerPosition(event: ReactMouseEvent | MouseEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function moveFromDrag(drag: Extract<Drag, { kind: "move" }>, x: number, y: number, viewport: Viewport, snap: number): ObjectMove {
  const beats = snapBeat((x - drag.startX) / viewport.pixelsPerBeat, snap);
  const lanes = Math.round((y - drag.startY) / LANE_HEIGHT);
  const from = cellOfLane(drag.anchorLane);
  const to = cellOfLane(drag.anchorLane + lanes);
  return { beats, columns: to.x - from.x, rows: to.y - from.y };
}

export function Timeline(props: TimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.floor(entry.contentRect.width)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const dragPreview: DragPreview | null = drag?.kind === "move" && pointer
    ? { ids: drag.ids, ...moveFromDrag(drag, pointer.x, pointer.y, props.viewport, props.snap) }
    : null;
  const marquee: Marquee | null = drag?.kind === "marquee" && pointer ? { x1: drag.startX, y1: drag.startY, x2: pointer.x, y2: pointer.y } : null;
  const wallPreview = drag?.kind === "wall" && pointer
    ? { fromBeat: drag.fromBeat, toBeat: snapBeat(xToBeat(pointer.x, props.viewport), props.snap), column: drag.column, width: props.settings.wallWidth }
    : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = TIMELINE_HEIGHT * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawTimeline(context, {
      width, chart: props.chart, selection: props.selection, cursorBeat: props.cursorBeat, playheadBeat: props.playheadBeat,
      viewport: props.viewport, timing: props.timing, peaks: props.peaks, snap: props.snap, dragPreview, marquee, wallPreview,
    }, TIMELINE_HEIGHT);
  });

  const snappedBeatAt = (x: number) => Math.max(0, snapBeat(xToBeat(x, props.viewport), props.snap));

  const onMouseDown = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = pointerPosition(event, canvas);
    setPointer({ x, y });
    if (y < LANES_TOP) {
      props.onCursor(snappedBeatAt(x));
      setDrag({ kind: "seek" });
      return;
    }
    const hit = objectAtPoint(props.chart, x, y, props.viewport);
    if (event.button === 2) {
      if (hit) props.onDelete(new Set([hit.id]));
      return;
    }
    if (hit) {
      const alreadySelected = props.selection.has(hit.id);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        props.onSelect(new Set([hit.id]), "toggle");
        return;
      }
      const ids = alreadySelected ? props.selection : new Set([hit.id]);
      if (!alreadySelected) props.onSelect(new Set([hit.id]), "replace");
      setDrag({ kind: "move", startX: x, startY: y, anchorLane: laneOf(hit), ids });
      return;
    }
    const lane = laneAtY(y);
    const cell = lane === null ? null : cellOfLane(lane);
    if (props.settings.tool === "wall" && cell) {
      setDrag({ kind: "wall", fromBeat: snappedBeatAt(x), column: Math.min(cell.x, GRID_COLUMNS - props.settings.wallWidth) });
      return;
    }
    setDrag({ kind: "pending", startX: x, startY: y, beat: snappedBeatAt(x), cell });
  };

  const onMouseMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !drag) return;
    const position = pointerPosition(event, canvas);
    setPointer(position);
    if (drag.kind === "seek") props.onCursor(snappedBeatAt(position.x));
    if (drag.kind === "pending" && Math.hypot(position.x - drag.startX, position.y - drag.startY) > DRAG_THRESHOLD_PIXELS) {
      setDrag({ kind: "marquee", startX: drag.startX, startY: drag.startY, additive: event.shiftKey });
    }
  };

  const finishDrag = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !drag) return;
    const { x, y } = pointerPosition(event, canvas);
    if (drag.kind === "move") {
      const move = moveFromDrag(drag, x, y, props.viewport, props.snap);
      if (move.beats !== 0 || move.columns !== 0 || move.rows !== 0) props.onMove(drag.ids, move);
    }
    if (drag.kind === "marquee") props.onSelect(objectsInMarquee(props.chart, { x1: drag.startX, y1: drag.startY, x2: x, y2: y }, props.viewport), drag.additive ? "add" : "replace");
    if (drag.kind === "wall") props.onPlaceWall(drag.fromBeat, snappedBeatAt(x), drag.column);
    if (drag.kind === "pending") {
      props.onCursor(drag.beat);
      if (drag.cell && props.settings.tool !== "select") props.onPlace(drag.beat, drag.cell);
      else props.onSelect(new Set(), "replace");
    }
    setDrag(null);
  };

  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { viewport, onViewportChange } = latest.current;
      if (event.ctrlKey || event.metaKey) {
        const { x } = pointerPosition(event, canvas);
        onViewportChange(zoomAround(viewport, x, event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP));
        return;
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      onViewportChange({ ...viewport, leftBeat: Math.max(-4, viewport.leftBeat + delta / viewport.pixelsPerBeat) });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={containerRef} className="timeline">
      <canvas
        ref={canvasRef}
        data-testid="timeline"
        style={{ width: `${width}px`, height: `${TIMELINE_HEIGHT}px` }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={finishDrag}
        onMouseLeave={(event) => drag && finishDrag(event)}
        onContextMenu={(event) => event.preventDefault()}
      />
    </div>
  );
}
