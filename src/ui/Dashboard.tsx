import { useCallback, useEffect, useState } from "react";
import type { BatchMaker } from "../batch/batchMaker";
import { type ExportDestination, type ExportProgress, type ExportReport, exportProjects } from "../batch/exportMaps";
import { DEFAULT_PROJECT_NAME, newProject } from "../core/model";
import { folderPickerAvailable, pickCustomLevelsFolder } from "../quest/folder";
import type { Backup, ProjectStore, ProjectSummary } from "../storage/projectStore";
import { BatchPanel, useBatchSnapshot } from "./BatchPanel";
import { errorMessage, formatTimestamp } from "./format";
import { audioContext } from "./session";
import { QuestSongs } from "./QuestSongs";
import { type Headset, useHeadset } from "./useHeadset";

interface DashboardProps {
  store: ProjectStore;
  batch: BatchMaker;
  onOpen: (projectId: string) => void;
}


function reportText(report: ExportReport, destination: ExportDestination["kind"]): string {
  const count = `${report.exported.length} ${report.exported.length === 1 ? "map" : "maps"}`;
  if (destination === "quest") {
    const left = report.alreadyOnHeadset.length;
    const alreadyThere = left > 0 ? ` ${left} already on the headset ${left === 1 ? "was" : "were"} left alone.` : "";
    return `Installed ${count} on the Quest.${alreadyThere} Restart Beat Saber or refresh songs to see them.`;
  }
  const where = destination === "zip" ? ` in ${report.zipParts} zip ${report.zipParts === 1 ? "file" : "files"}` : " into CustomLevels";
  return `Exported ${count}${where}.`;
}

interface ExportBarProps {
  store: ProjectStore;
  projects: ProjectSummary[];
  selected: ReadonlySet<string>;
  headset: Headset;
  onSelect: (ids: ReadonlySet<string>) => void;
}

function ExportBar({ store, projects, selected, headset, onSelect }: ExportBarProps) {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [report, setReport] = useState<{ text: string; skipped: ExportReport["skipped"]; alreadyOnHeadset: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceOnHeadset, setReplaceOnHeadset] = useState(false);
  const mapped = projects.filter((project) => project.noteCount > 0);
  const busy = progress !== null || headset.connecting;

  const runExport = async (chooseDestination: () => Promise<ExportDestination>) => {
    setError(null);
    setReport(null);
    try {
      const destination = await chooseDestination();
      const ids = projects.filter((project) => selected.has(project.id)).map((project) => project.id);
      setProgress({ done: 0, total: ids.length, current: "" });
      const result = await exportProjects(ids, destination, { store, context: audioContext, onProgress: setProgress });
      setReport({ text: reportText(result, destination.kind), skipped: result.skipped, alreadyOnHeadset: result.alreadyOnHeadset });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="card" data-testid="export-bar">
      <h3>Export or install many</h3>
      <p className="meta">
        Tick projects below, then export them together or install them straight onto the Quest. Zips are split every 256 MB so a big export never has to sit in memory at once.
      </p>
      <div className="toolbar wrap">
        <span className="meta" data-testid="selected-count">{selected.size} selected</span>
        <button onClick={() => onSelect(new Set(mapped.map((project) => project.id)))} disabled={mapped.length === 0 || busy}>Select all with notes ({mapped.length})</button>
        <button onClick={() => onSelect(new Set())} disabled={selected.size === 0 || busy}>Clear selection</button>
        <button className="primary" disabled={selected.size === 0 || busy} onClick={() => void runExport(async () => ({ kind: "zip" }))} data-testid="export-many-zip">Download as .zip</button>
        <button disabled={selected.size === 0 || busy || !folderPickerAvailable()}
          onClick={() => void runExport(async () => ({ kind: "folder", customLevels: await pickCustomLevelsFolder() }))}>Save into a CustomLevels folder</button>
      </div>
      <div className="toolbar wrap" data-testid="quest-install-bar">
        <button disabled={!headset.usbAvailable || busy} onClick={() => void headset.connect()}>{headset.connection ? "Reconnect the Quest" : "Connect the Quest over USB"}</button>
        {headset.connection && <button disabled={busy} onClick={() => void headset.disconnect()}>Disconnect</button>}
        <label>
          <input type="checkbox" checked={replaceOnHeadset} onChange={(event) => setReplaceOnHeadset(event.target.checked)} /> Replace maps already on the headset
        </label>
        <button className="primary" disabled={selected.size === 0 || busy || !headset.connection} data-testid="install-many-quest"
          onClick={() => void runExport(async () => {
            if (!headset.connection) throw new Error("connect the Quest first");
            return { kind: "quest", connection: headset.connection, replaceExisting: replaceOnHeadset };
          })}>Install {selected.size} on the Quest</button>
      </div>
      {!headset.usbAvailable && <p className="meta">Installing on the Quest needs WebUSB, so use Chrome or Edge on a computer.</p>}
      {headset.note && <p className="meta" data-testid="headset-note">{headset.note}</p>}
      {headset.error && <div className="error-banner" role="alert">{headset.error}</div>}
      {progress && (
        <div className="info-banner" role="status">
          Exporting {Math.min(progress.done + 1, progress.total)} of {progress.total}{progress.current ? `: ${progress.current}` : ""}
          <progress className="batch-progress" max={progress.total} value={progress.done} />
        </div>
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {report && (
        <div data-testid="export-many-result">
          <p className="meta ok">{report.text}</p>
          {(report.skipped.length > 0 || report.alreadyOnHeadset.length > 0) && (
            <ul className="batch-list">
              {report.alreadyOnHeadset.map((name) => <li key={`there-${name}`} className="existing"><span className="status">Already there</span><span className="label">{name}</span><span className="message">left alone on the headset</span></li>)}
              {report.skipped.map((skip) => <li key={skip.name} className="skipped"><span className="status">Skipped</span><span className="label">{skip.name}</span><span className="message">{skip.reason}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function Dashboard({ store, batch, onOpen }: DashboardProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const headset = useHeadset();
  const madeByBatch = useBatchSnapshot(batch).counts.done;

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
  }, [run, madeByBatch]);

  const toggleSelected = (projectId: string) => {
    const next = new Set(selected);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    setSelected(next);
  };

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
      <BatchPanel batch={batch} onSelectMade={(ids) => setSelected(new Set(ids))} />
      {projects.length > 0 && <ExportBar store={store} projects={projects} selected={selected} headset={headset} onSelect={setSelected} />}
      <QuestSongs headset={headset} projects={projects} />
      {projects.length === 0 ? (
        <div className="empty">No projects yet. Start one with New project.</div>
      ) : (
        <div className="project-list">
          {projects.map((summary) => (
            <ProjectCard key={summary.id} summary={summary} store={store} run={run} onOpen={onOpen} selected={selected.has(summary.id)} onToggle={() => toggleSelected(summary.id)} />
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
  selected: boolean;
  onToggle: () => void;
}

function ProjectCard({ summary, store, run, onOpen, selected, onToggle }: ProjectCardProps) {
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
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${summary.name}`} />
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
          {summary.songTitle ?? "No song yet"} · {summary.noteCount} notes · edited {formatTimestamp(summary.updatedAt)}
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
