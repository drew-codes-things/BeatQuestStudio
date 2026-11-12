export type SaveState = "saved" | "pending" | "saving" | "failed";

export interface Autosaver<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
  cancel(): void;
}

export function createAutosaver<T>(
  save: (value: T) => Promise<void>,
  delayMs: number,
  onStateChange: (state: SaveState, error?: Error) => void,
): Autosaver<T> {
  let pendingValue: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const writePending = async () => {
    clearTimer();
    if (!pendingValue) return;
    const { value } = pendingValue;
    pendingValue = null;
    onStateChange("saving");
    try {
      await save(value);
      onStateChange(pendingValue ? "pending" : "saved");
    } catch (cause) {
      pendingValue ??= { value };
      const error = cause instanceof Error ? cause : new Error(String(cause));
      onStateChange("failed", error);
    }
  };

  const flush = () => {
    running = running.then(writePending);
    return running;
  };

  return {
    schedule(value: T) {
      pendingValue = { value };
      onStateChange("pending");
      clearTimer();
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    cancel() {
      clearTimer();
      pendingValue = null;
    },
  };
}
