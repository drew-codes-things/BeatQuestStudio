import { useCallback, useEffect, useState } from "react";
import { newProject } from "../core/model";
import type { Backup, ProjectStore, ProjectSummary } from "../storage/projectStore";
import { errorMessage, formatTimestamp } from "./format";

interface DashboardProps {
  store: ProjectStore;
  onOpen: (projectId: string) => void;
}

const DEFAULT_PROJECT_NAME = "Untitled map";

export function Dashboard({ store, onOpen }: DashboardProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setProjects(await store.listProjects());
  }, [store]);

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      setError(null);
      await action();
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [refresh]);

  useEffect(() => {
    void run(async () => {});
  }, [run]);

  const createProject = () => run(async () => {
    const project = newProject(crypto.randomUUID(), DEFAULT_PROJECT_NAME, Date.now());
    await store.saveProject(project);
    onOpen(project.id);
  });

  return (
    <main className="page">
      <div className="toolbar">
        <button className="primary" onClick={createProject}>New project</button>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {projects.length === 0 ? (
        <div className="empty">No projects yet. Start one with New project.</div>
      ) : (
        <div className="project-list">
          {projects.map((summary) => (
            <ProjectCard key={summary.id} summary={summary} store={store} run={run} onOpen={onOpen} />
          ))}
        </div>
      )}
    </main>
  );
}

interface ProjectCardProps {
  summary: ProjectSummary;
  store: ProjectStore;
  run: (action: () => Promise<void>) => Promise<void>;
  onOpen: (projectId: string) => void;
}

function ProjectCard({ summary, store, run, onOpen }: ProjectCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(summary.name);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [backups, setBackups] = useState<Backup[] | null>(null);

  const loadRequired = async () => {
    const project = await store.loadProject(summary.id);
    if (!project) throw new Error(`project "${summary.name}" is no longer in storage`);
    return project;
  };

  const saveRename = () => run(async () => {
    const trimmed = draftName.trim();
    if (!trimmed) throw new Error("a project name cannot be empty");
    const project = await loadRequired();
    await store.saveProject({ ...project, name: trimmed, updatedAt: Date.now() });
    setRenaming(false);
  });

  const duplicate = () => run(async () => {
    await store.duplicateProject(summary.id, crypto.randomUUID(), `${summary.name} (copy)`, Date.now());
  });

  const backUpNow = () => run(async () => {
    await store.createBackup(await loadRequired(), "manual", Date.now());
    if (backups) setBackups(await store.listBackups(summary.id));
  });

  const toggleBackups = () => run(async () => {
    setBackups(backups ? null : await store.listBackups(summary.id));
  });

  const restore = (backup: Backup) => run(async () => {
    await store.restoreBackup(backup, Date.now());
    setBackups(await store.listBackups(summary.id));
  });

  const remove = () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    void run(() => store.deleteProject(summary.id));
  };

  return (
    <div className="project-card">
      <div className="spacer">
        {renaming ? (
          <form onSubmit={(event) => { event.preventDefault(); void saveRename(); }}>
            <input type="text" value={draftName} autoFocus aria-label="Project name" onChange={(event) => setDraftName(event.target.value)} />
            <button type="submit">Save</button>
            <button type="button" onClick={() => { setRenaming(false); setDraftName(summary.name); }}>Cancel</button>
          </form>
        ) : (
          <div className="name" onClick={() => onOpen(summary.id)}>{summary.name}</div>
        )}
        <div className="meta">
          {summary.songTitle ?? "No song yet"} · edited {formatTimestamp(summary.updatedAt)}
        </div>
        {backups && (
          <div className="backup-list">
            {backups.length === 0 && <span className="meta">No backups yet.</span>}
            {backups.map((backup) => (
              <div className="backup-row" key={backup.id}>
                <span className="spacer">{formatTimestamp(backup.takenAt)} · {backup.label} · {backup.project.name}</span>
                <button onClick={() => void restore(backup)}>Restore</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="actions">
        <button onClick={() => onOpen(summary.id)}>Open</button>
        <button onClick={() => setRenaming(true)}>Rename</button>
        <button onClick={() => void duplicate()}>Duplicate</button>
        <button onClick={() => void backUpNow()}>Back up</button>
        <button onClick={() => void toggleBackups()}>{backups ? "Hide backups" : "Backups"}</button>
        <button className={deleteArmed ? "danger armed" : "danger"} onClick={remove} onBlur={() => setDeleteArmed(false)}>
          {deleteArmed ? "Click again to delete" : "Delete"}
        </button>
      </div>
    </div>
  );
}
