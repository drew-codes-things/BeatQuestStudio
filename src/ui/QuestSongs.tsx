import { useMemo, useRef, useState } from "react";
import { deleteInstalledSong, type InstalledSong, matchStudioProject, readInstalledSongs, type ReadProgress } from "../quest/installedSongs";
import type { ProjectSummary } from "../storage/projectStore";
import { errorMessage, formatBytes } from "./format";
import type { Headset } from "./useHeadset";

const ROWS_SHOWN = 200;

type SortKey = "title" | "artist" | "size";

const SORTERS: Record<SortKey, (left: InstalledSong, right: InstalledSong) => number> = {
  title: (left, right) => left.title.localeCompare(right.title),
  artist: (left, right) => left.artist.localeCompare(right.artist) || left.title.localeCompare(right.title),
  size: (left, right) => right.sizeBytes - left.sizeBytes,
};

function matchesSearch(song: InstalledSong, search: string): boolean {
  if (search === "") return true;
  return [song.title, song.subTitle, song.artist, song.mapper, song.folder].some((field) => field.toLowerCase().includes(search));
}

interface SongRowProps {
  song: InstalledSong;
  studioName: string | null;
  armed: boolean;
  busy: boolean;
  onDelete: () => void;
  onDisarm: () => void;
}

function SongRow({ song, studioName, armed, busy, onDelete, onDisarm }: SongRowProps) {
  const details = [song.artist, song.mapper ? `mapped by ${song.mapper}` : "", song.bpm === null ? "" : `${Math.round(song.bpm * 100) / 100} BPM`, song.difficulties.join(", "), formatBytes(song.sizeBytes)].filter(Boolean);
  return (
    <li className={song.problem ? "skipped" : studioName ? "existing" : ""} data-testid="quest-song-row">
      <span className="label">{song.title}{song.subTitle ? ` (${song.subTitle})` : ""}</span>
      {studioName && <span className="status">Made in BeatQuest</span>}
      <button className={armed ? "danger armed row-action" : "danger row-action"} disabled={busy} onClick={onDelete} onBlur={onDisarm}>
        {armed ? "Click again to remove from the Quest" : "Remove"}
      </button>
      <span className="message">{song.problem ?? details.join(" · ")}</span>
    </li>
  );
}

export function QuestSongs({ headset, projects }: { headset: Headset; projects: ProjectSummary[] }) {
  const [songs, setSongs] = useState<InstalledSong[] | null>(null);
  const [progress, setProgress] = useState<ReadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("title");
  const [armedFolder, setArmedFolder] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const stopRequested = useRef(false);
  const reading = progress !== null;

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (songs ?? []).filter((song) => matchesSearch(song, needle)).sort(SORTERS[sortKey]);
  }, [songs, search, sortKey]);
  const totalBytes = (songs ?? []).reduce((total, song) => total + song.sizeBytes, 0);
  const madeHere = (songs ?? []).filter((song) => matchStudioProject(song.folder, projects)).length;

  const read = async () => {
    if (!headset.connection) return;
    stopRequested.current = false;
    setError(null);
    setNote(null);
    setProgress({ done: 0, total: 0 });
    try {
      setSongs(await readInstalledSongs(headset.connection, { onProgress: setProgress, shouldStop: () => stopRequested.current }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setProgress(null);
    }
  };

  const remove = async (song: InstalledSong) => {
    if (!headset.connection) return;
    if (armedFolder !== song.folder) {
      setArmedFolder(song.folder);
      return;
    }
    setArmedFolder(null);
    setRemoving(true);
    setError(null);
    try {
      await deleteInstalledSong(headset.connection, song.folder);
      setSongs((current) => (current ?? []).filter((other) => other.folder !== song.folder));
      setNote(`Removed "${song.title}" from the Quest. Restart Beat Saber or refresh songs to update the list in the game.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="card" data-testid="quest-songs">
      <h3>Songs on the Quest</h3>
      <p className="meta">
        See every custom song on the headset with its mapper, difficulties and size, and remove the ones you no longer want. Connect the Quest in the box above first.
      </p>
      <div className="toolbar wrap">
        <button className="primary" disabled={!headset.connection || reading || removing} onClick={() => void read()} data-testid="read-quest-songs">
          {songs ? "Read the Quest again" : "Read songs from the Quest"}
        </button>
        {reading && <button onClick={() => { stopRequested.current = true; }}>Stop</button>}
        {songs && (
          <>
            <input type="text" placeholder="Search songs" aria-label="Search songs on the Quest" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select aria-label="Sort songs" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="title">Sort by title</option>
              <option value="artist">Sort by artist</option>
              <option value="size">Largest first</option>
            </select>
          </>
        )}
      </div>
      {!headset.connection && <p className="meta">The Quest is not connected.</p>}
      {reading && <div className="info-banner" role="status">Reading {progress.done} of {progress.total || "?"} songs<progress className="batch-progress" max={progress.total || 1} value={progress.done} /></div>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {note && <p className="meta ok" role="status">{note}</p>}
      {songs && (
        <>
          <p className="meta" data-testid="quest-songs-summary">
            {songs.length} {songs.length === 1 ? "song" : "songs"} using {formatBytes(totalBytes)}, {madeHere} made in BeatQuest.
            {shown.length !== songs.length ? ` Showing ${shown.length} that match.` : ""}
          </p>
          <ul className="batch-list">
            {shown.slice(0, ROWS_SHOWN).map((song) => (
              <SongRow key={song.folder} song={song} studioName={matchStudioProject(song.folder, projects)?.name ?? null} armed={armedFolder === song.folder}
                busy={removing || reading} onDelete={() => void remove(song)} onDisarm={() => setArmedFolder(null)} />
            ))}
          </ul>
          {shown.length > ROWS_SHOWN && <p className="meta">Showing {ROWS_SHOWN} of {shown.length}: search to narrow it down.</p>}
        </>
      )}
    </section>
  );
}
