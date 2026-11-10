import { useState } from "react";
import { type Chart, chartObjectCount, DIFFICULTIES, type Difficulty, difficultyLabel, type Project } from "../core/model";
import { FIXED_MAP_SEED, generateCharts } from "../generator/generate";
import type { ProjectStore } from "../storage/projectStore";
import { errorMessage } from "./format";
import type { SongSession } from "./session";

interface AutoMapPanelProps {
  project: Project;
  store: ProjectStore;
  session: SongSession | null;
  onGenerated: (charts: Partial<Record<Difficulty, Chart>>) => void;
}

export function AutoMapPanel({ project, store, session, onGenerated }: AutoMapPanelProps) {
  const [chosen, setChosen] = useState<Set<Difficulty>>(new Set(DIFFICULTIES));
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const willReplace = DIFFICULTIES.filter((difficulty) => chosen.has(difficulty) && chartObjectCount(project.charts[difficulty]) > 0);

  const generate = async () => {
    if (!session) return;
    if (willReplace.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setError(null);
    try {
      await store.createBackup(project, "before auto-map", Date.now());
      const charts = generateCharts(project.timing, session.analysis, DIFFICULTIES.filter((difficulty) => chosen.has(difficulty)), FIXED_MAP_SEED, () => crypto.randomUUID());
      onGenerated(charts);
      const summary = Object.entries(charts).map(([difficulty, chart]) => `${difficultyLabel(difficulty as Difficulty)} ${chart.notes.length}`).join(", ");
      setStatus(`Drafted ${summary} notes. A backup of the previous version was saved.`);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const toggle = (difficulty: Difficulty) => {
    setConfirming(false);
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(difficulty)) next.delete(difficulty);
      else next.add(difficulty);
      return next;
    });
  };

  return (
    <main className="page">
      <section className="card">
        <h3>Auto-map</h3>
        <p className="meta">
          Drafts each difficulty on its own from the song's beats and loudness: Easy is not cut down from Expert. Notes follow how human
          mappers place them, so swings alternate and flow from one to the next. Every note lands on the beat grid from the Song tab, so
          check the BPM and offset there first. Everything it makes is ordinary notes you can edit or delete.
        </p>
        {!session && <div className="info-banner">Import a song first.</div>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="toolbar">
          {DIFFICULTIES.map((difficulty) => (
            <label key={difficulty} className="check">
              <input type="checkbox" checked={chosen.has(difficulty)} onChange={() => toggle(difficulty)} /> {difficultyLabel(difficulty)}
              <span className="meta"> ({chartObjectCount(project.charts[difficulty])} now)</span>
            </label>
          ))}
        </div>
        <div className="toolbar">
          <button className={confirming ? "danger armed" : "primary"} disabled={!session || chosen.size === 0} onClick={() => void generate()} data-testid="generate">
            {confirming ? `Replace ${willReplace.join(", ")}? Click again` : "Generate"}
          </button>
        </div>
        {status && <p className="meta ok" role="status">{status}</p>}
      </section>
    </main>
  );
}
