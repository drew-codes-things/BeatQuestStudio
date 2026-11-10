import { useEffect, useState, useSyncExternalStore } from "react";
import { IMPORT_ACCEPT, isSupportedImport } from "../audio/decode";
import type { BatchMaker } from "../batch/batchMaker";
import { BATCH_ITEM_TIMEOUT_MS, MAX_IMPORT_BYTES, MAX_SONG_SECONDS } from "../batch/limits";
import type { BatchItem, BatchSnapshot, BatchStatus } from "../batch/queue";
import { batchHeadline } from "./batchSummary";
import { collectDroppedFiles, type DroppedItem, type EntryLike } from "./dropped";
import { errorMessage } from "./format";

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

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function droppedItems(transfer: DataTransfer): DroppedItem[] {
  return Array.from(transfer.items, (item) => ({
    entry: (item.webkitGetAsEntry?.() as unknown as EntryLike | null | undefined) ?? null,
    file: item.kind === "file" ? item.getAsFile() : null,
  }));
}

export function BatchPanel({ batch }: { batch: BatchMaker }) {
  const snapshot = useBatchSnapshot(batch);
  const { counts } = snapshot;
  const total = snapshot.items.length;
  const finished = counts.done + counts.existing + counts.failed + counts.skipped;
  const needsAttention = counts.failed + counts.skipped;
  const [ignored, setIgnored] = useState<number | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = (files: File[], onlyMedia: boolean) => {
    const chosen = onlyMedia ? files.filter((file) => isSupportedImport(file.name, file.type)) : files;
    setIgnored(onlyMedia ? files.length - chosen.length : null);
    if (chosen.length === 0) return;
    batch.addFiles(chosen);
    batch.start();
  };

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      setDragging(false);
      setDropError(null);
      const items = droppedItems(event.dataTransfer);
      collectDroppedFiles(items).then((files) => addFiles(files, true)).catch((cause: unknown) => setDropError(errorMessage(cause)));
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [batch]);

  return (
    <section className={dragging ? "card batch dragging" : "card batch"} data-testid="batch-panel">
      <h3>Make maps from your songs</h3>
      <div className="dropzone">
        <p className="dropzone-title">{dragging ? "Let go to add them" : "Drop songs or a whole folder anywhere on this page"}</p>
        <p className="meta">MP3, WAV, OGG, FLAC, M4A or video. Each song gets Easy, Normal, Hard, Expert and Expert+, and songs you already made are skipped.</p>
        <div className="toolbar wrap center">
          <label className="file-button">
            Add songs
            <input type="file" multiple accept={IMPORT_ACCEPT} data-testid="batch-files" onChange={(event) => { addFiles(Array.from(event.target.files ?? []), false); event.target.value = ""; }} />
          </label>
          <label className="file-button">
            Add a folder
            <input type="file" multiple ref={(node) => node?.setAttribute("webkitdirectory", "")} data-testid="batch-folder"
              onChange={(event) => { addFiles(Array.from(event.target.files ?? []), true); event.target.value = ""; }} />
          </label>
        </div>
      </div>
      {dropError && <div className="error-banner" role="alert">{dropError}</div>}
      {ignored !== null && ignored > 0 && <p className="meta">Left out {ignored} files in that folder that are not audio or video.</p>}
      {snapshot.halted && <div className="error-banner" role="alert">{snapshot.halted}</div>}
      {total > 0 && (
        <>
          <progress className="batch-progress" max={total} value={finished} />
          <p className="headline" data-testid="batch-progress" data-total={total} data-finished={finished} data-made={counts.done} data-existing={counts.existing}
            data-failed={counts.failed} data-skipped={counts.skipped} data-running={snapshot.running ? "true" : "false"}>
            {batchHeadline(counts, snapshot.running)}
          </p>
          <div className="toolbar wrap">
            {snapshot.running && <button onClick={() => batch.queue.stop()} disabled={snapshot.stopping}>{snapshot.stopping ? "Stopping after this song..." : "Stop after this song"}</button>}
            {!snapshot.running && counts.waiting > 0 && <button className="primary" onClick={() => batch.start()}>Start</button>}
            <button onClick={() => batch.queue.clearFinished()} disabled={finished === 0}>Clear finished</button>
          </div>
          <details className="rows" open={needsAttention > 0}>
            <summary>{needsAttention > 0 ? `Song by song (${needsAttention} need a look)` : "Song by song"}</summary>
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
          </details>
        </>
      )}
      <details className="limits">
        <summary>Limits</summary>
        <p className="meta">
          Songs are worked through one at a time so the browser stays responsive. {Math.round(MAX_IMPORT_BYTES / MEGABYTE)} MB and {MAX_SONG_SECONDS / SECONDS_PER_MINUTE} minutes per song,
          {" "}{BATCH_ITEM_TIMEOUT_MS / MS_PER_MINUTE} minutes of work per song, and the batch pauses itself if browser storage runs low.
        </p>
      </details>
    </section>
  );
}
