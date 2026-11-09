import type { BatchStatus } from "../batch/queue";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function batchHeadline(counts: Record<BatchStatus, number>, running: boolean): string {
  const finished = counts.done + counts.existing + counts.failed + counts.skipped;
  const total = finished + counts.waiting + counts.working;
  if (total === 0) return "";
  const parts = [
    counts.done > 0 ? plural(counts.done, "new map", "new maps") : null,
    counts.existing > 0 ? `${counts.existing} already made` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.skipped > 0 ? `${counts.skipped} skipped` : null,
  ].filter((part): part is string => part !== null);
  const list = parts.join(", ");
  const progress = `${finished} of ${total} done${list ? ` (${list})` : ""}`;
  if (running) return `Working: ${progress}.`;
  if (counts.waiting > 0) return `Paused: ${progress}. Press Start to carry on.`;
  return `Done: ${list}.`;
}
