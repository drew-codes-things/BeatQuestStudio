import { type CutDirection, DIFFICULTIES, type Difficulty } from "../../core/model";
import { SNAP_DIVISIONS } from "./geometry";
import type { PlacementSettings, Tool, WallShape } from "./placement";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1] as const;

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "5" },
  { tool: "red", label: "Red", key: "1" },
  { tool: "blue", label: "Blue", key: "2" },
  { tool: "bomb", label: "Bomb", key: "3" },
  { tool: "wall", label: "Wall", key: "4" },
];

const DIRECTION_PAD: CutDirection[] = ["upLeft", "up", "upRight", "left", "any", "right", "downLeft", "down", "downRight"];
const DIRECTION_SYMBOLS: Record<CutDirection, string> = {
  upLeft: "↖", up: "↑", upRight: "↗", left: "←", any: "•", right: "→", downLeft: "↙", down: "↓", downRight: "↘",
};

interface EditorToolbarProps {
  settings: PlacementSettings;
  onSettings: (settings: PlacementSettings) => void;
  snap: number;
  onSnap: (snap: number) => void;
  playing: boolean;
  canPlay: boolean;
  onPlayToggle: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
  ticks: boolean;
  onTicks: (ticks: boolean) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  onDelete: () => void;
  onSwapColor: () => void;
  onMirror: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
  onArc: () => void;
  onChain: () => void;
  difficulty: Difficulty;
  onCopyToDifficulty: (target: Difficulty) => void;
  onZoom: (factor: number) => void;
  onShowPreview: () => void;
  previewShown: boolean;
}

export function EditorToolbar(props: EditorToolbarProps) {
  const set = (change: Partial<PlacementSettings>) => props.onSettings({ ...props.settings, ...change });
  return (
    <div className="editor-toolbar">
      <div className="tool-group" role="group" aria-label="Tool">
        {TOOLS.map(({ tool, label, key }) => (
          <button key={tool} className={props.settings.tool === tool ? `tool active ${tool}` : `tool ${tool}`} title={`${label} (${key})`} onClick={() => set({ tool })}>{label}</button>
        ))}
      </div>
      <div className="direction-pad" role="group" aria-label="Cut direction">
        {DIRECTION_PAD.map((direction) => (
          <button key={direction} className={props.settings.direction === direction ? "active" : ""} title={direction} aria-label={`Direction ${direction}`} onClick={() => set({ direction })}>
            {DIRECTION_SYMBOLS[direction]}
          </button>
        ))}
      </div>
      {props.settings.tool === "wall" && (
        <div className="tool-group">
          <label>Width <select value={props.settings.wallWidth} onChange={(event) => set({ wallWidth: Number(event.target.value) })}>{[1, 2, 3, 4].map((width) => <option key={width} value={width}>{width}</option>)}</select></label>
          <label>Type <select value={props.settings.wallShape} onChange={(event) => set({ wallShape: event.target.value as WallShape })}><option value="full">Full height</option><option value="crouch">Crouch</option></select></label>
        </div>
      )}
      <div className="tool-group">
        <label>Snap <select aria-label="Snap" value={props.snap} onChange={(event) => props.onSnap(Number(event.target.value))}>{SNAP_DIVISIONS.map((division) => <option key={division} value={division}>1/{division}</option>)}</select></label>
        <button onClick={() => props.onZoom(1.25)} title="Zoom in (+)">+</button>
        <button onClick={() => props.onZoom(0.8)} title="Zoom out (-)">-</button>
      </div>
      <div className="tool-group">
        <button className="primary" disabled={!props.canPlay} onClick={props.onPlayToggle} title="Play or pause (Space)">{props.playing ? "Pause" : "Play"}</button>
        <select aria-label="Playback speed" value={props.speed} onChange={(event) => props.onSpeed(Number(event.target.value))}>{PLAYBACK_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed * 100}%</option>)}</select>
        <label><input type="checkbox" checked={props.ticks} onChange={(event) => props.onTicks(event.target.checked)} /> Note ticks</label>
      </div>
      <div className="tool-group">
        <button disabled={!props.canUndo} onClick={props.onUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button disabled={!props.canRedo} onClick={props.onRedo} title="Redo (Ctrl+Y)">Redo</button>
        <button disabled={!props.hasSelection} onClick={props.onCopy} title="Copy (Ctrl+C)">Copy</button>
        <button disabled={!props.canPaste} onClick={props.onPaste} title="Paste at cursor (Ctrl+V)">Paste</button>
        <button disabled={!props.hasSelection} onClick={props.onSwapColor} title="Swap colour (F)">Swap colour</button>
        <button disabled={!props.hasSelection} onClick={props.onMirror} title="Mirror (M)">Mirror</button>
        <button disabled={!props.hasSelection} onClick={props.onArc} title="Arc between two selected notes">Arc</button>
        <button disabled={!props.hasSelection} onClick={props.onChain} title="Chain between two selected notes">Chain</button>
        <button disabled={!props.hasSelection} className="danger" onClick={props.onDelete} title="Delete (Del)">Delete</button>
        <select
          aria-label="Copy selection to difficulty"
          disabled={!props.hasSelection}
          value=""
          onChange={(event) => event.target.value && props.onCopyToDifficulty(event.target.value as Difficulty)}
        >
          <option value="">Copy to...</option>
          {DIFFICULTIES.filter((difficulty) => difficulty !== props.difficulty).map((difficulty) => <option key={difficulty} value={difficulty}>{difficulty}</option>)}
        </select>
        <button onClick={props.onShowPreview}>{props.previewShown ? "Hide 3D" : "Show 3D"}</button>
      </div>
    </div>
  );
}
