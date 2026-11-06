import { useState } from "react";
import { type Chart, chartObjectCount, DIFFICULTIES, type Difficulty, type Project } from "../core/model";
import { generateChart } from "../generator/generate";
import type { ProjectStore } from "../storage/projectStore";
import { errorMessage } from "./format";
import type { SongSession } from "./session";

interface AutoMapPanelProps {
  project: Project;
  store: ProjectStore;
  session: SongSession | null;
  onGenerated: (charts: Partial<Record<Difficulty, Chart>>) => void;
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function AutoMapPanel({ project, store, session, onGenerated }: AutoMapPanelProps) {
  const [chosen, setChosen] = useState<Set<Difficulty>>(new Set(DIFFICULTIES));
  const [seed, setSeed] = useState(randomSeed);
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
      const input = { timing: project.timing, durationSeconds: session.analysis.durationSeconds, onsets: session.analysis.onsets, energy: session.analysis.energy };
      const charts: Partial<Record<Difficulty, Chart>> = {};
      for (const difficulty of DIFFICULTIES) {
        if (chosen.has(difficulty)) charts[difficulty] = generateChart(input, difficulty, seed, () => crypto.randomUUID());
      }
      onGenerated(charts);
      const summary = Object.entries(charts).map(([difficulty, chart]) => `${difficulty} ${chart.notes.length}`).join(", ");
      setStatus(`Drafted ${summary} notes from seed "${seed}". A backup of the previous version was saved.`);
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
          Drafts each difficulty on its own from the song's beats and loudness: Easy is not cut down from Expert. Every note lands on the beat grid
          from the Song tab, so check the BPM and offset there first. Everything it makes is ordinary notes you can edit or delete.
        </p>
        {!session && <div className="info-banner">Import a song first.</div>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="toolbar">
          {DIFFICULTIES.map((difficulty) => (
            <label key={difficulty} className="check">
              <input type="checkbox" checked={chosen.has(difficulty)} onChange={() => toggle(difficulty)} /> {difficulty}
              <span className="meta"> ({chartObjectCount(project.charts[difficulty])} now)</span>
            </label>
          ))}
        </div>
        <div className="toolbar">
          <label className="field inline"><span>Seed</span><input type="text" value={seed} onChange={(event) => { setSeed(event.target.value); setConfirming(false); }} /></label>
          <button onClick={() => { setSeed(randomSeed()); setConfirming(false); }}>New seed</button>
          <button className={confirming ? "danger armed" : "primary"} disabled={!session || chosen.size === 0} onClick={() => void generate()} data-testid="generate">
            {confirming ? `Replace ${willReplace.join(", ")}? Click again` : "Generate"}
          </button>
        </div>
        {status && <p className="meta ok" role="status">{status}</p>}
      </section>
    </main>
  );
}
