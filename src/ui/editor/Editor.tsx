import { useCallback, useEffect, useRef, useState } from "react";
import {
  allObjects,
  BEAT_EPSILON,
  type Clipboard,
  copySelection,
  copyToChart,
  findObjectAt,
  mirrorObjects,
  moveObjects,
  type ObjectMove,
  pasteClipboard,
  recolorObjects,
  removeObjects,
  setDirection,
} from "../../core/edit";
import { type Chart, type CutDirection, chartObjectCount, DIFFICULTIES, type Difficulty, type Project } from "../../core/model";
import { beatToSeconds, secondsToBeat, snapBeat } from "../../core/timing";
import type { SongSession } from "../session";
import { EditorToolbar } from "./EditorToolbar";
import { type Cell, type Viewport, zoomAround, LABEL_WIDTH } from "./geometry";
import { GridPanel } from "./GridPanel";
import { arcFromSelection, chainFromSelection, type PlacementSettings, placeAt, placeWall, type SliderResult, type Tool } from "./placement";
import { Preview3D } from "./Preview3D";
import { type SelectMode, Timeline } from "./Timeline";

export interface EditorFocus {
  difficulty: Difficulty;
  beat: number;
  ids: string[];
}

interface EditorProps {
  project: Project;
  difficulty: Difficulty;
  onDifficulty: (difficulty: Difficulty) => void;
  onEditChart: (difficulty: Difficulty, update: (chart: Chart) => Chart) => void;
  session: SongSession | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  focus: EditorFocus | null;
}

const DEFAULT_VIEWPORT: Viewport = { leftBeat: -1, pixelsPerBeat: 80 };
const DEFAULT_SNAP = 4;
const FOLLOW_MARGIN = 0.75;
const KEY_ZOOM_STEP = 1.25;
const GRID_WALL_BEATS = 1;

const TOOL_KEYS: Record<string, Tool> = { "1": "red", "2": "blue", "3": "bomb", "4": "wall", "5": "select" };
const DIRECTION_KEYS: Record<string, CutDirection> = {
  w: "up", s: "down", a: "left", d: "right", q: "upLeft", e: "upRight", z: "downLeft", c: "downRight", x: "any",
};

const newId = () => crypto.randomUUID();

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
}

export function Editor(props: EditorProps) {
  const { project, difficulty, session } = props;
  const chart = project.charts[difficulty];
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [cursorBeat, setCursorBeat] = useState(0);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [snap, setSnap] = useState(DEFAULT_SNAP);
  const [settings, setSettings] = useState<PlacementSettings>({ tool: "red", direction: "down", wallWidth: 1, wallShape: "full" });
  const [playing, setPlaying] = useState(false);
  const [playheadBeat, setPlayheadBeat] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);
  const [ticks, setTicks] = useState(true);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewShown, setPreviewShown] = useState(true);
  const timelineWidth = useRef(900);

  useEffect(() => setSelection(new Set()), [difficulty]);

  useEffect(() => {
    if (!props.focus) return;
    setCursorBeat(props.focus.beat);
    setSelection(new Set(props.focus.ids));
    setViewport((current) => ({ ...current, leftBeat: props.focus!.beat - 4 }));
  }, [props.focus]);

  const edit = useCallback((update: (current: Chart) => Chart) => props.onEditChart(difficulty, update), [props, difficulty]);

  const select = (ids: Set<string>, mode: SelectMode) => {
    setSelection((current) => {
      if (mode === "replace") return ids;
      const next = new Set(current);
      for (const id of ids) {
        if (mode === "toggle" && next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const place = (beat: number, cell: Cell, direction: CutDirection | null = null) => {
    const result = placeAt(chart, beat, cell, { ...settings, direction: direction ?? settings.direction }, newId);
    if (!result) return;
    edit(() => result.chart);
    setSelection(new Set([result.id]));
  };

  const applySlider = (build: (current: Chart, ids: ReadonlySet<string>) => SliderResult) => {
    const result = build(chart, selection);
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    edit(() => result.chart);
    setSelection(new Set([result.id]));
    setMessage(null);
  };

  const deleteSelection = () => {
    if (selection.size === 0) return;
    const ids = selection;
    edit((current) => removeObjects(current, ids));
    setSelection(new Set());
  };

  const copy = () => {
    const copied = copySelection(chart, selection);
    if (copied) {
      setClipboard(copied);
      setMessage(`Copied ${selection.size} object${selection.size === 1 ? "" : "s"}.`);
    }
  };

  const paste = () => {
    if (!clipboard) return;
    const result = pasteClipboard(chart, clipboard, cursorBeat, newId);
    edit(() => result.chart);
    setSelection(result.ids);
  };

  const copyToDifficulty = (target: Difficulty) => {
    const result = copyToChart(chart, selection, project.charts[target], newId);
    props.onEditChart(target, () => result.chart);
    setMessage(`Copied ${result.ids.size} object${result.ids.size === 1 ? "" : "s"} to ${target} at the same beats.`);
  };

  const move = (ids: ReadonlySet<string>, change: ObjectMove) => edit((current) => moveObjects(current, ids, change));

  const stop = useCallback(() => {
    if (!session) return;
    session.player.pause();
    setPlaying(false);
    const beat = secondsToBeat(session.player.currentTime(), project.timing);
    setCursorBeat(Math.max(0, snapBeat(beat, snap)));
    setPlayheadBeat(null);
  }, [session, project.timing, snap]);

  const play = useCallback(async () => {
    if (!session) return;
    const noteTimes = (from: number, to: number) => chart.notes
      .map((note) => beatToSeconds(note.beat, project.timing))
      .filter((seconds, index, all) => seconds >= from && seconds < to && all.indexOf(seconds) === index);
    session.player.setRate(speed);
    await session.player.play(Math.max(0, beatToSeconds(cursorBeat, project.timing)), ticks ? noteTimes : undefined);
    setPlaying(true);
  }, [session, chart, project.timing, speed, cursorBeat, ticks]);

  const togglePlay = useCallback(() => (playing ? stop() : void play()), [playing, stop, play]);

  useEffect(() => {
    if (!session) return;
    session.player.onEnded(() => {
      setPlaying(false);
      setPlayheadBeat(null);
    });
    return () => session.player.pause();
  }, [session]);

  useEffect(() => {
    if (!playing || !session) return;
    let frame = 0;
    const tick = () => {
      const beat = secondsToBeat(session.player.currentTime(), project.timing);
      setPlayheadBeat(beat);
      setViewport((current) => {
        const visibleBeats = (timelineWidth.current - LABEL_WIDTH) / current.pixelsPerBeat;
        const outside = beat > current.leftBeat + visibleBeats * FOLLOW_MARGIN || beat < current.leftBeat;
        return outside ? { ...current, leftBeat: beat - visibleBeats * 0.25 } : current;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, session, project.timing]);

  useEffect(() => {
    if (session && playing) session.player.setRate(speed);
  }, [speed, session, playing]);

  const zoom = (factor: number) => setViewport((current) => zoomAround(current, LABEL_WIDTH + (timelineWidth.current - LABEL_WIDTH) / 2, factor));

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    const command = event.ctrlKey || event.metaKey;
    const step = 1 / snap;
    if (key === " ") {
      event.preventDefault();
      togglePlay();
    } else if (command && key === "z" && !event.shiftKey) {
      event.preventDefault();
      props.onUndo();
    } else if (command && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      props.onRedo();
    } else if (command && key === "c") copy();
    else if (command && key === "x") {
      copy();
      deleteSelection();
    } else if (command && key === "v") paste();
    else if (command && key === "a") {
      event.preventDefault();
      setSelection(new Set(allObjects(chart).map((object) => object.id)));
    } else if (key === "delete" || key === "backspace") deleteSelection();
    else if (key === "escape") setSelection(new Set());
    else if (key === "arrowright" || key === "arrowleft") {
      event.preventDefault();
      const delta = key === "arrowright" ? step : -step;
      if (event.shiftKey && selection.size > 0) move(selection, { beats: delta, columns: 0, rows: 0 });
      else if (event.altKey && selection.size > 0) move(selection, { beats: 0, columns: Math.sign(delta), rows: 0 });
      else setCursorBeat((current) => Math.max(0, snapBeat(current + delta, snap)));
    } else if ((key === "arrowup" || key === "arrowdown") && event.altKey && selection.size > 0) {
      event.preventDefault();
      move(selection, { beats: 0, columns: 0, rows: key === "arrowup" ? 1 : -1 });
    } else if (!command && key in TOOL_KEYS) setSettings((current) => ({ ...current, tool: TOOL_KEYS[key]! }));
    else if (!command && key in DIRECTION_KEYS) {
      const direction = DIRECTION_KEYS[key]!;
      if (selection.size > 0) edit((current) => setDirection(current, selection, direction));
      else setSettings((current) => ({ ...current, direction }));
    } else if (!command && key === "f" && selection.size > 0) edit((current) => recolorObjects(current, selection, "swap"));
    else if (!command && key === "m" && selection.size > 0) edit((current) => mirrorObjects(current, selection));
    else if (key === "+" || key === "=") zoom(KEY_ZOOM_STEP);
    else if (key === "-") zoom(1 / KEY_ZOOM_STEP);
  };
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const onGridClick = (cell: Cell, direction: CutDirection | null, additive: boolean) => {
    const existing = findObjectAt(chart, cursorBeat, cell.x, cell.y);
    if (existing && (settings.tool === "select" || (!direction && additive))) {
      select(new Set([existing.id]), additive ? "toggle" : "replace");
      return;
    }
    if (existing && direction && "direction" in existing) {
      edit((current) => setDirection(current, new Set([existing.id]), direction));
      return;
    }
    if (settings.tool === "wall") {
      const result = placeWall(chart, cursorBeat, cursorBeat + GRID_WALL_BEATS, cell.x, settings, newId);
      if (result) edit(() => result.chart);
      return;
    }
    place(cursorBeat, cell, direction);
  };

  const onGridDelete = (cell: Cell) => {
    const existing = findObjectAt(chart, cursorBeat, cell.x, cell.y);
    if (existing) edit((current) => removeObjects(current, new Set([existing.id])));
  };

  const shownBeat = playheadBeat ?? cursorBeat;
  const objectsAtCursor = allObjects(chart).filter((object) => Math.abs(object.beat - cursorBeat) < BEAT_EPSILON).length;

  return (
    <div className="editor">
      <div className="difficulty-tabs" role="tablist">
        {DIFFICULTIES.map((option) => (
          <button key={option} role="tab" aria-selected={option === difficulty} className={option === difficulty ? "tab active" : "tab"} onClick={() => props.onDifficulty(option)}>
            {option} <span className="count">{chartObjectCount(project.charts[option])}</span>
          </button>
        ))}
      </div>
      <EditorToolbar
        settings={settings}
        onSettings={setSettings}
        snap={snap}
        onSnap={setSnap}
        playing={playing}
        canPlay={session !== null}
        onPlayToggle={togglePlay}
        speed={speed}
        onSpeed={setSpeed}
        ticks={ticks}
        onTicks={setTicks}
        canUndo={props.canUndo}
        canRedo={props.canRedo}
        onUndo={props.onUndo}
        onRedo={props.onRedo}
        hasSelection={selection.size > 0}
        onDelete={deleteSelection}
        onSwapColor={() => edit((current) => recolorObjects(current, selection, "swap"))}
        onMirror={() => edit((current) => mirrorObjects(current, selection))}
        onCopy={copy}
        onPaste={paste}
        canPaste={clipboard !== null}
        onArc={() => applySlider((current, ids) => arcFromSelection(current, ids, newId))}
        onChain={() => applySlider((current, ids) => chainFromSelection(current, ids, newId))}
        difficulty={difficulty}
        onCopyToDifficulty={copyToDifficulty}
        onZoom={zoom}
        onShowPreview={() => setPreviewShown((shown) => !shown)}
        previewShown={previewShown}
      />
      <div className="status-line" role="status">
        <span>Beat <strong data-testid="cursor-beat">{Math.round(cursorBeat * 1000) / 1000}</strong> · {objectsAtCursor} here · {selection.size} selected · {chart.notes.length} notes</span>
        {message && <span className="message">{message}</span>}
      </div>
      <div ref={(element) => { if (element) timelineWidth.current = element.clientWidth; }}>
        <Timeline
          chart={chart}
          selection={selection}
          cursorBeat={cursorBeat}
          playheadBeat={playheadBeat}
          viewport={viewport}
          timing={project.timing}
          peaks={session?.peaks ?? null}
          snap={snap}
          settings={settings}
          onViewportChange={setViewport}
          onCursor={(beat) => setCursorBeat(beat)}
          onSelect={select}
          onPlace={(beat, cell) => place(beat, cell)}
          onPlaceWall={(fromBeat, toBeat, column) => {
            const result = placeWall(chart, fromBeat, toBeat, column, settings, newId);
            if (result) {
              edit(() => result.chart);
              setSelection(new Set([result.id]));
            }
          }}
          onMove={move}
          onDelete={(ids) => edit((current) => removeObjects(current, ids))}
        />
      </div>
      <div className="editor-lower">
        <div>
          <h4>Grid at the cursor</h4>
          <GridPanel chart={chart} beat={cursorBeat} selection={selection} onCellClick={onGridClick} onCellDelete={onGridDelete} />
          <p className="hint">Click a cell to place. Drag across a cell to choose the cut direction. Right-click to delete.</p>
        </div>
        {previewShown && (
          <div>
            <h4>3D preview</h4>
            <Preview3D chart={chart} beat={shownBeat} />
          </div>
        )}
        <ShortcutHelp />
      </div>
    </div>
  );
}

function ShortcutHelp() {
  return (
    <div className="shortcuts">
      <h4>Shortcuts</h4>
      <dl>
        <dt>Space</dt><dd>Play / pause from the cursor</dd>
        <dt>1 2 3 4 5</dt><dd>Red, blue, bomb, wall, select</dd>
        <dt>W A S D, Q E Z C, X</dt><dd>Cut direction (dot on X); changes the selection if any</dd>
        <dt>Left / Right</dt><dd>Move the cursor one snap step</dd>
        <dt>Shift + Left / Right</dt><dd>Move the selection in time</dd>
        <dt>Alt + arrows</dt><dd>Move the selection on the grid</dd>
        <dt>F / M</dt><dd>Swap colour / mirror</dd>
        <dt>Ctrl + C, X, V, A</dt><dd>Copy, cut, paste at cursor, select all</dd>
        <dt>Ctrl + Z / Ctrl + Y</dt><dd>Undo / redo</dd>
        <dt>Delete</dt><dd>Delete the selection</dd>
        <dt>Ctrl + wheel, + / -</dt><dd>Zoom the timeline</dd>
        <dt>Shift + drag</dt><dd>Add to the selection</dd>
      </dl>
    </div>
  );
}
