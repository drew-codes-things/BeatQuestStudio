export type BatchStatus = "waiting" | "working" | "done" | "failed" | "skipped";

export interface BatchItem<T> {
  id: number;
  input: T;
  label: string;
  status: BatchStatus;
  message: string | null;
}

export interface BatchEntry<T> {
  input: T;
  label: string;
  rejection: string | null;
}

export interface BatchSnapshot<T> {
  items: readonly BatchItem<T>[];
  counts: Record<BatchStatus, number>;
  running: boolean;
  stopping: boolean;
  halted: string | null;
}

export interface BatchQueueOptions<T> {
  process: (input: T) => Promise<string>;
  timeoutMs: number;
  restMs: number;
  checkRoom?: (input: T) => Promise<string | null>;
  onTimeout?: () => void;
}

class BatchTimeoutError extends Error {}

function withTimeout<R>(work: Promise<R>, timeoutMs: number): Promise<R> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BatchTimeoutError(`took longer than ${Math.round(timeoutMs / 1000)} seconds, so it was stopped`)), timeoutMs);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

function rest(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function countStatuses<T>(items: readonly BatchItem<T>[]): Record<BatchStatus, number> {
  const counts: Record<BatchStatus, number> = { waiting: 0, working: 0, done: 0, failed: 0, skipped: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

export class BatchQueue<T> {
  private items: BatchItem<T>[] = [];
  private nextId = 1;
  private running = false;
  private stopping = false;
  private halted: string | null = null;
  private loop: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private current: BatchSnapshot<T>;

  constructor(private readonly options: BatchQueueOptions<T>) {
    this.current = this.buildSnapshot();
  }

  add(entries: readonly BatchEntry<T>[]): void {
    for (const entry of entries) {
      const skipped = entry.rejection !== null;
      this.items.push({ id: this.nextId++, input: entry.input, label: entry.label, status: skipped ? "skipped" : "waiting", message: entry.rejection });
    }
    this.notify();
  }

  start(): Promise<void> {
    if (this.loop) return this.loop;
    this.halted = null;
    this.stopping = false;
    this.running = true;
    this.notify();
    this.loop = this.runLoop().finally(() => {
      this.running = false;
      this.stopping = false;
      this.loop = null;
      this.notify();
    });
    return this.loop;
  }

  stop(): void {
    if (!this.running) return;
    this.stopping = true;
    this.notify();
  }

  clearFinished(): void {
    this.items = this.items.filter((item) => item.status === "waiting" || item.status === "working");
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): BatchSnapshot<T> {
    return this.current;
  }

  private async runLoop(): Promise<void> {
    for (let item = this.nextWaiting(); item && !this.stopping; item = this.nextWaiting()) {
      const roomProblem = this.options.checkRoom ? await this.options.checkRoom(item.input) : null;
      if (roomProblem) {
        this.halted = roomProblem;
        return;
      }
      await this.runItem(item);
      if (this.nextWaiting()) await rest(this.options.restMs);
    }
  }

  private nextWaiting(): BatchItem<T> | undefined {
    return this.items.find((item) => item.status === "waiting");
  }

  private async runItem(item: BatchItem<T>): Promise<void> {
    this.update(item.id, { status: "working", message: null });
    try {
      const message = await withTimeout(this.options.process(item.input), this.options.timeoutMs);
      this.update(item.id, { status: "done", message });
    } catch (cause) {
      if (cause instanceof BatchTimeoutError) this.options.onTimeout?.();
      this.update(item.id, { status: "failed", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  private update(id: number, change: Pick<BatchItem<T>, "status" | "message">): void {
    this.items = this.items.map((item) => (item.id === id ? { ...item, ...change } : item));
    this.notify();
  }

  private buildSnapshot(): BatchSnapshot<T> {
    return { items: this.items, counts: countStatuses(this.items), running: this.running, stopping: this.stopping, halted: this.halted };
  }

  private notify(): void {
    this.current = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}
