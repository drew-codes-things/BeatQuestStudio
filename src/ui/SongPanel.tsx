import { useEffect, useState } from "react";
import { measureGridDriftMs } from "../audio/beatGrid";
import { IMPORT_ACCEPT } from "../audio/decode";
import { DEFAULT_SABER_COLORS, DIFFICULTIES, difficultyLabel, type Project, type SaberColors, type SongInfo } from "../core/model";
import { beatToSeconds, validateBpm } from "../core/timing";
import type { ProjectStore } from "../storage/projectStore";
import { DRIFT_WARNING_MS } from "../validation/validate";
import { errorMessage } from "./format";
import type { SongSession } from "./session";

interface SongPanelProps {
  project: Project;
  store: ProjectStore;
  session: SongSession | null;
  busy: string | null;
  onImport: (file: File) => void;
  onChange: (update: (project: Project) => Project) => void;
}

const OFFSET_NUDGES_MS = [-10, -1, 1, 10];
const MS_PER_SECOND = 1000;
const COVER_ACCEPT = "image/png,image/jpeg";

function TextField({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()} />
    </label>
  );
}

function SaberColorsCard({ colors, onChange }: { colors: SaberColors | null; onChange: (colors: SaberColors | null) => void }) {
  return (
    <section className="card" data-testid="saber-colors">
      <h3>Saber colours</h3>
      <label className="check">
        <input type="checkbox" checked={colors !== null} onChange={(event) => onChange(event.target.checked ? { ...DEFAULT_SABER_COLORS } : null)} />
        Use my own colours for this map
      </label>
      {colors && (
        <div className="field-grid">
          <label className="field">
            <span>Left saber</span>
            <input type="color" aria-label="Left saber colour" value={colors.left} onChange={(event) => onChange({ ...colors, left: event.target.value })} />
          </label>
          <label className="field">
            <span>Right saber</span>
            <input type="color" aria-label="Right saber colour" value={colors.right} onChange={(event) => onChange({ ...colors, right: event.target.value })} />
          </label>
        </div>
      )}
      <p className="meta">
        In Beat Saber the cubes always take their saber's colour, so changing a saber recolours its cubes too. The lights follow the
        sabers and walls take the left colour. The editor shows the cubes in these colours.
      </p>
    </section>
  );
}

function NumberField({ label, value, step, onCommit, testId }: { label: string; value: number; step: number; onCommit: (value: number) => void; testId?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
    else setDraft(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" inputMode="decimal" data-testid={testId} value={draft} step={step} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()} />
    </label>
  );
}

export function SongPanel({ project, store, session, busy, onImport, onChange }: SongPanelProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [beatCheck, setBeatCheck] = useState(false);
  const song = project.song;

  useEffect(() => {
    let url: string | null = null;
    store.loadCover(project.id).then((cover) => {
      if (!cover) {
        setCoverUrl(null);
        return;
      }
      url = URL.createObjectURL(new Blob([cover.bytes], { type: cover.mimeType }));
      setCoverUrl(url);
    }).catch((cause: unknown) => setError(errorMessage(cause)));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [store, project.id, song?.fileName]);

  const changeSong = (change: Partial<SongInfo>) => onChange((current) => current.song ? { ...current, song: { ...current.song, ...change } } : current);
  const changeTiming = (bpm: number, offsetSeconds: number) => {
    const problem = validateBpm(bpm);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const drift = session ? measureGridDriftMs(session.analysis.attack, bpm, offsetSeconds, session.analysis.durationSeconds) : null;
    onChange((current) => ({
      ...current,
      timing: { bpm, offsetSeconds },
      song: current.song ? { ...current.song, beatDriftMs: drift ?? current.song.beatDriftMs } : current.song,
    }));
  };

  const uploadCover = async (file: File) => {
    try {
      await store.saveCover({ projectId: project.id, fileName: file.name, mimeType: file.type, bytes: await file.arrayBuffer() });
      setCoverUrl(URL.createObjectURL(file));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const toggleBeatCheck = async () => {
    if (!session) return;
    if (beatCheck) {
      session.player.pause();
      setBeatCheck(false);
      return;
    }
    const beatTimes = (from: number, to: number) => {
      const times: number[] = [];
      const period = 60 / project.timing.bpm;
      for (let beat = Math.ceil((from - project.timing.offsetSeconds) / period); ; beat += 1) {
        const seconds = beatToSeconds(beat, project.timing);
        if (seconds >= to) break;
        if (seconds >= from) times.push(seconds);
      }
      return times;
    };
    session.player.setRate(1);
    await session.player.play(song?.previewStartSeconds ?? 0, beatTimes);
    session.player.onEnded(() => setBeatCheck(false));
    setBeatCheck(true);
  };

  const detected = session?.analysis.tempo;
  const drift = song?.beatDriftMs ?? null;

  return (
    <main className="page song-panel">
      {error && <div className="error-banner" role="alert">{error}</div>}
      {busy && <div className="info-banner" role="status">{busy}</div>}
      <section className="card">
        <h3>Song file</h3>
        <p className="meta">MP3, WAV, OGG, Opus, FLAC, M4A/AAC, or a video (MP4, MOV, WebM): from a video only the sound is kept.</p>
        <input type="file" accept={IMPORT_ACCEPT} aria-label="Import song" data-testid="import-song" disabled={busy !== null}
          onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ""; }} />
        {song && <p className="meta" data-testid="song-summary">{song.fileName} · {Math.floor(song.durationSeconds / 60)}:{String(Math.floor(song.durationSeconds % 60)).padStart(2, "0")}</p>}
      </section>
      {song && (
        <>
          <section className="card">
            <h3>Details</h3>
            <div className="field-grid">
              <TextField label="Title" value={song.title} onCommit={(title) => changeSong({ title })} />
              <TextField label="Sub title" value={song.subTitle} onCommit={(subTitle) => changeSong({ subTitle })} />
              <TextField label="Artist" value={song.artist} onCommit={(artist) => changeSong({ artist })} />
              <TextField label="Mapper" value={song.mapper} onCommit={(mapper) => changeSong({ mapper })} />
              <NumberField label="Preview start (s)" value={song.previewStartSeconds} step={0.1} onCommit={(previewStartSeconds) => changeSong({ previewStartSeconds })} />
              <NumberField label="Preview length (s)" value={song.previewDurationSeconds} step={0.1} onCommit={(previewDurationSeconds) => changeSong({ previewDurationSeconds })} />
            </div>
          </section>
          <section className="card">
            <h3>Beat grid</h3>
            <div className="field-grid">
              <NumberField label="BPM" testId="bpm" value={project.timing.bpm} step={0.001} onCommit={(bpm) => changeTiming(bpm, project.timing.offsetSeconds)} />
              <NumberField label="Offset (ms)" testId="offset" value={Math.round(project.timing.offsetSeconds * MS_PER_SECOND * 10) / 10} step={1}
                onCommit={(offsetMs) => changeTiming(project.timing.bpm, offsetMs / MS_PER_SECOND)} />
            </div>
            <div className="toolbar">
              <button onClick={() => changeTiming(project.timing.bpm * 2, project.timing.offsetSeconds)}>BPM x2</button>
              <button onClick={() => changeTiming(project.timing.bpm / 2, project.timing.offsetSeconds)}>BPM /2</button>
              {OFFSET_NUDGES_MS.map((nudge) => (
                <button key={nudge} onClick={() => changeTiming(project.timing.bpm, project.timing.offsetSeconds + nudge / MS_PER_SECOND)}>{nudge > 0 ? `+${nudge}` : nudge} ms</button>
              ))}
              {detected && <button onClick={() => changeTiming(detected.bpm, detected.offsetSeconds)}>Use detected ({detected.bpm} BPM)</button>}
              <button disabled={!session} onClick={() => void toggleBeatCheck()}>{beatCheck ? "Stop beat check" : "Play with beat clicks"}</button>
            </div>
            <p className={drift !== null && drift > DRIFT_WARNING_MS ? "meta warn" : "meta"} data-testid="grid-fit">
              {drift === null ? "Grid fit not measured yet." : `Grid fit: the beats land within ${drift} ms of the music in 90% of the song.`}
              {drift !== null && drift > DRIFT_WARNING_MS && " The tempo may change during the song; check the grid against the waveform."}
            </p>
          </section>
          <section className="card">
            <h3>Cover</h3>
            {coverUrl ? <img className="cover" src={coverUrl} alt="Cover" /> : <p className="meta">No cover yet: one is made from the title when you export.</p>}
            <input type="file" accept={COVER_ACCEPT} aria-label="Upload cover" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCover(file); }} />
          </section>
          <SaberColorsCard colors={project.saberColors ?? null} onChange={(saberColors) => onChange((current) => ({ ...current, saberColors }))} />
          <section className="card">
            <h3>Note speed</h3>
            <div className="field-grid">
              {DIFFICULTIES.map((difficulty) => (
                <NumberField key={difficulty} label={`${difficultyLabel(difficulty)} jump speed`} value={project.settings[difficulty].noteJumpSpeed} step={0.5}
                  onCommit={(noteJumpSpeed) => onChange((current) => ({ ...current, settings: { ...current.settings, [difficulty]: { ...current.settings[difficulty], noteJumpSpeed } } }))} />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
