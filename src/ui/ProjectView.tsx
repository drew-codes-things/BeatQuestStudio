import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioWorkerClient } from "../audio/workerProtocol";
import { type History, record, redo, startHistory, undo } from "../core/history";
import type { Chart, Difficulty, Project } from "../core/model";
import { createAutosaver, type SaveState } from "../storage/autosave";
import type { ProjectStore } from "../storage/projectStore";
import { AutoMapPanel } from "./AutoMapPanel";
import { CheckPanel } from "./CheckPanel";
import { Editor, type EditorFocus } from "./editor/Editor";
import { errorMessage } from "./format";
import { withImportedSong } from "../import/songImport";
import { importSongFile, openSession, type SongSession } from "./session";
import { SongPanel } from "./SongPanel";

interface ProjectViewProps {
  store: ProjectStore;
  projectId: string;
  onClose: () => void;
}

type Tab = "song" | "map" | "automap" | "check";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "song", label: "Song" },
  { tab: "map", label: "Map" },
  { tab: "automap", label: "Auto-map" },
  { tab: "check", label: "Check & export" },
];

const AUTOSAVE_DELAY_MS = 800;

const SAVE_STATE_LABELS: Record<SaveState, string> = {
  saved: "All changes saved",
  pending: "Unsaved changes",
  saving: "Saving...",
  failed: "Save failed",
};

export function ProjectView({ store, projectId, onClose }: ProjectViewProps) {
  const [history, setHistory] = useState<History<Project> | null>(null);
  const historyRef = useRef<History<Project> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("song");
  const [difficulty, setDifficulty] = useState<Difficulty>("Expert");
  const [session, setSession] = useState<SongSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [songError, setSongError] = useState<string | null>(null);
  const [focus, setFocus] = useState<EditorFocus | null>(null);
  const worker = useMemo(() => new AudioWorkerClient(), []);

  useEffect(() => () => worker.dispose(), [worker]);

  const autosaver = useMemo(() => createAutosaver<Project>((value) => store.saveProject(value), AUTOSAVE_DELAY_MS, (state, error) => {
    setSaveState(state);
    setSaveError(error ? error.message : null);
  }), [store]);

  const replaceHistory = useCallback((next: History<Project>) => {
    historyRef.current = next;
    setHistory(next);
    autosaver.schedule(next.present);
  }, [autosaver]);

  const change = useCallback((update: (project: Project) => Project) => {
    const current = historyRef.current;
    if (!current) return;
    replaceHistory(record(current, { ...update(current.present), updatedAt: Date.now() }));
  }, [replaceHistory]);

  const editChart = useCallback((target: Difficulty, update: (chart: Chart) => Chart) => {
    change((project) => ({ ...project, charts: { ...project.charts, [target]: update(project.charts[target]) } }));
  }, [change]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await store.loadProject(projectId);
      if (cancelled) return;
      if (!loaded) {
        setLoadError("This project no longer exists.");
        return;
      }
      const initial = startHistory(loaded);
      historyRef.current = initial;
      setHistory(initial);
      if (loaded.song) setTab("map");
      const audio = await store.loadAudio(projectId);
      if (!audio || cancelled) return;
      setBusy("Loading and analysing the song...");
      const opened = await openSession(audio.bytes, audio.fileName, worker);
      if (!cancelled) setSession(opened);
    })()
      .catch((cause: unknown) => !cancelled && setSongError(errorMessage(cause)))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
      void autosaver.flush();
    };
  }, [store, projectId, worker, autosaver]);

  useEffect(() => () => session?.player.dispose(), [session]);

  const importSong = async (file: File) => {
    setSongError(null);
    setBusy(file.type.startsWith("video/") ? "Taking the sound out of the video and analysing it..." : "Reading and analysing the song...");
    try {
      const imported = await importSongFile(file, worker);
      await store.saveAudio({ projectId, ...imported.audio });
      session?.player.dispose();
      setSession(imported.session);
      const { analysis } = imported.session;
      change((project) => withImportedSong(project, { storedFileName: imported.audio.fileName, sourceName: file.name, analysis }, Date.now()));
    } catch (cause) {
      setSongError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    session?.player.pause();
    await autosaver.flush();
    onClose();
  };

  if (loadError) {
    return (
      <main className="page">
        <div className="error-banner" role="alert">{loadError}</div>
        <button onClick={onClose}>Back to projects</button>
      </main>
    );
  }

  if (!history) return <main className="page">Loading project...</main>;
  const project = history.present;

  return (
    <div className="project-view">
      <div className="project-bar">
        <button onClick={() => void close()}>Back to projects</button>
        <h2 className="spacer">{project.name}</h2>
        <nav className="tabs" role="tablist">
          {TABS.map((option) => (
            <button key={option.tab} role="tab" aria-selected={tab === option.tab} className={tab === option.tab ? "tab active" : "tab"} onClick={() => setTab(option.tab)}>{option.label}</button>
          ))}
        </nav>
        <span className={saveState === "failed" ? "save-state failed" : "save-state"} title={saveError ?? undefined} data-testid="save-state">
          {SAVE_STATE_LABELS[saveState]}{saveError ? `: ${saveError}` : ""}
        </span>
      </div>
      {songError && <div className="page"><div className="error-banner" role="alert">{songError}</div></div>}
      {tab === "song" && <SongPanel project={project} store={store} session={session} busy={busy} onImport={(file) => void importSong(file)} onChange={change} />}
      {tab === "map" && (
        <Editor
          project={project}
          difficulty={difficulty}
          onDifficulty={setDifficulty}
          onEditChart={editChart}
          session={session}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onUndo={() => historyRef.current && replaceHistory(undo(historyRef.current))}
          onRedo={() => historyRef.current && replaceHistory(redo(historyRef.current))}
          focus={focus}
        />
      )}
      {tab === "automap" && (
        <AutoMapPanel project={project} store={store} session={session}
          onGenerated={(charts) => change((current) => ({ ...current, charts: { ...current.charts, ...charts } }))} />
      )}
      {tab === "check" && (
        <CheckPanel project={project} store={store} session={session} worker={worker}
          onFocus={(next) => { setDifficulty(next.difficulty); setFocus(next); setTab("map"); }} />
      )}
    </div>
  );
}
