import { useEffect, useMemo, useState } from "react";
import { chartObjectCount, DIFFICULTIES, type Project } from "../core/model";
import { createAutosaver, type SaveState } from "../storage/autosave";
import type { ProjectStore } from "../storage/projectStore";
import { errorMessage } from "./format";

interface ProjectViewProps {
  store: ProjectStore;
  projectId: string;
  onClose: () => void;
}

const AUTOSAVE_DELAY_MS = 800;

const SAVE_STATE_LABELS: Record<SaveState, string> = {
  saved: "All changes saved",
  pending: "Unsaved changes",
  saving: "Saving...",
  failed: "Save failed",
};

export function ProjectView({ store, projectId, onClose }: ProjectViewProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);

  const autosaver = useMemo(() => createAutosaver<Project>(
    (value) => store.saveProject(value),
    AUTOSAVE_DELAY_MS,
    (state, error) => {
      setSaveState(state);
      setSaveError(error ? error.message : null);
    },
  ), [store]);

  useEffect(() => {
    store.loadProject(projectId)
      .then((loaded) => loaded ? setProject(loaded) : setLoadError("This project no longer exists."))
      .catch((cause: unknown) => setLoadError(errorMessage(cause)));
    return () => void autosaver.flush();
  }, [store, projectId, autosaver]);

  const close = async () => {
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

  if (!project) return <main className="page">Loading project...</main>;

  return (
    <main className="page">
      <div className="toolbar">
        <button onClick={() => void close()}>Back to projects</button>
        <h2 className="spacer" style={{ margin: 0 }}>{project.name}</h2>
        <span className={saveState === "failed" ? "save-state failed" : "save-state"} title={saveError ?? undefined}>
          {SAVE_STATE_LABELS[saveState]}{saveError ? `: ${saveError}` : ""}
        </span>
      </div>
      <p className="meta">{project.song ? project.song.title : "No song imported."} · {project.timing.bpm} BPM</p>
      <div className="difficulty-grid">
        {DIFFICULTIES.map((difficulty) => (
          <div className="difficulty-card" key={difficulty}>
            <h3>{difficulty}</h3>
            <div className="meta">{chartObjectCount(project.charts[difficulty])} objects</div>
          </div>
        ))}
      </div>
    </main>
  );
}
