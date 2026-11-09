import { useState, useSyncExternalStore } from "react";
import { IMPORT_ACCEPT, isSupportedImport } from "../audio/decode";
import type { BatchMaker } from "../batch/batchMaker";
import { BATCH_ITEM_TIMEOUT_MS, MAX_IMPORT_BYTES, MAX_SONG_SECONDS } from "../batch/limits";
import { type BatchItem, type BatchSnapshot, type BatchStatus, madeProjectIds } from "../batch/queue";

const ROWS_SHOWN = 100;
const MEGABYTE = 1024 * 1024;
const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;

const STATUS_LABELS: Record<BatchStatus, string> = {
  waiting: "Waiting",
  working: "Working",
  done: "Done",
  existing: "Already made",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_ORDER: Record<BatchStatus, number> = { working: 0, failed: 1, skipped: 2, waiting: 3, existing: 4, done: 5 };

export function useBatchSnapshot(batch: BatchMaker): BatchSnapshot<File> {
  return useSyncExternalStore((listener) => batch.queue.subscribe(listener), () => batch.queue.snapshot());
}

function rowsToShow(items: readonly BatchItem<File>[]): BatchItem<File>[] {
  return [...items].sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.id - right.id).slice(0, ROWS_SHOWN);
}

function progressText(snapshot: BatchSnapshot<File>): string {
  const { counts } = snapshot;
  const finished = counts.done + counts.existing + counts.failed + counts.skipped;
  const total = finished + counts.waiting + counts.working;
  return `${finished} of ${total} finished: ${counts.done} made, ${counts.existing} already made, ${counts.failed} failed, ${counts.skipped} skipped`;
}

interface BatchPanelProps {
  batch: BatchMaker;
  onSelectMade: (projectIds: string[]) => void;
}

export function BatchPanel({ batch, onSelectMade }: BatchPanelProps) {
  const snapshot = useBatchSnapshot(batch);
  const { counts } = snapshot;
  const total = snapshot.items.length;
  const finished = counts.done + counts.existing + counts.failed + counts.skipped;
  const madeIds = madeProjectIds(snapshot);
  const [ignored, setIgnored] = useState<number | null>(null);

  const addFiles = (list: FileList | null, onlyMedia: boolean) => {
    const files = Array.from(list ?? []);
    const chosen = onlyMedia ? files.filter((file) => isSupportedImport(file.name, file.type)) : files;
    setIgnored(onlyMedia ? files.length - chosen.length : null);
    if (chosen.length === 0) return;
    batch.addFiles(chosen);
    batch.start();
  };

  return (
    <section className="card batch" data-testid="batch-panel">
      <h3>Batch: a map for every song</h3>
      <p className="meta">
        Add as many songs or videos as you like. They are worked through one at a time so the browser stays responsive, and each becomes its own
        project with Easy, Normal, Hard and Expert drafted. A song you have already made (same title, artist and length) is spotted and left alone.
        Limits: {Math.round(MAX_IMPORT_BYTES / MEGABYTE)} MB and {MAX_SONG_SECONDS / SECONDS_PER_MINUTE} minutes per
        song, {BATCH_ITEM_TIMEOUT_MS / MS_PER_MINUTE} minutes of work per song, and the batch pauses itself if browser storage runs low.
      </p>
      <div className="toolbar wrap">
        <label className="file-button">
          Add songs
          <input type="file" multiple accept={IMPORT_ACCEPT} data-testid="batch-files" onChange={(event) => { addFiles(event.target.files, false); event.target.value = ""; }} />
        </label>
        <label className="file-button">
          Add a folder
          <input type="file" multiple ref={(node) => node?.setAttribute("webkitdirectory", "")} data-testid="batch-folder"
            onChange={(event) => { addFiles(event.target.files, true); event.target.value = ""; }} />
        </label>
        {snapshot.running
          ? <button onClick={() => batch.queue.stop()} disabled={snapshot.stopping}>{snapshot.stopping ? "Stopping after this song..." : "Stop after this song"}</button>
          : <button className="primary" onClick={() => batch.start()} disabled={counts.waiting === 0}>Start</button>}
        <button onClick={() => batch.queue.clearFinished()} disabled={finished === 0}>Clear finished</button>
        <button onClick={() => onSelectMade(madeIds)} disabled={madeIds.length === 0 || snapshot.running} data-testid="select-batch-maps">
          Select these {madeIds.length} maps for export or the Quest
        </button>
      </div>
      {ignored !== null && ignored > 0 && <p className="meta">Left out {ignored} files in that folder that are not audio or video.</p>}
      {snapshot.halted && <div className="error-banner" role="alert">{snapshot.halted}</div>}
      {total > 0 && (
        <>
          <progress className="batch-progress" max={total} value={finished} />
          <p className="meta" data-testid="batch-progress">{progressText(snapshot)}{snapshot.running ? "" : counts.waiting > 0 ? ". Paused." : "."}</p>
          <ul className="batch-list">
            {rowsToShow(snapshot.items).map((item) => (
              <li key={item.id} className={item.status} data-testid="batch-row">
                <span className="status">{STATUS_LABELS[item.status]}</span>
                <span className="label">{item.label}</span>
                {item.message && <span className="message">{item.message}</span>}
              </li>
            ))}
          </ul>
          {total > ROWS_SHOWN && <p className="meta">Showing {ROWS_SHOWN} of {total}: anything still working or with a problem comes first.</p>}
        </>
      )}
    </section>
  );
}
