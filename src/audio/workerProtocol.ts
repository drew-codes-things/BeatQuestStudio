import type { SongAnalysis, WaveformPeaks } from "./analysis";

export type WorkerRequest =
  | { id: number; kind: "analyse"; channels: Float32Array[]; sampleRate: number }
  | { id: number; kind: "encode"; channels: Float32Array[]; sampleRate: number };

export type WorkerResponse =
  | { id: number; ok: true; kind: "analyse"; analysis: SongAnalysis; peaks: WaveformPeaks }
  | { id: number; ok: true; kind: "encode"; bytes: Uint8Array }
  | { id: number; ok: false; error: string };

export class AudioWorkerClient {
  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (response: WorkerResponse) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const waiter = this.pending.get(event.data.id);
      if (!waiter) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) waiter.resolve(event.data);
      else waiter.reject(new Error(event.data.error));
    };
    this.worker.onerror = (event) => {
      const error = new Error(`audio worker failed: ${event.message}`);
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };
  }

  async analyse(channels: Float32Array[], sampleRate: number): Promise<{ analysis: SongAnalysis; peaks: WaveformPeaks }> {
    const response = await this.request({ kind: "analyse", channels: channels.map((channel) => channel.slice()), sampleRate });
    if (response.ok && response.kind === "analyse") return { analysis: response.analysis, peaks: response.peaks };
    throw new Error("audio worker answered an analysis with the wrong result");
  }

  async encodeOgg(channels: Float32Array[], sampleRate: number): Promise<Uint8Array> {
    const response = await this.request({ kind: "encode", channels: channels.map((channel) => channel.slice()), sampleRate });
    if (response.ok && response.kind === "encode") return response.bytes;
    throw new Error("audio worker answered an encode with the wrong result");
  }

  dispose(): void {
    this.worker.terminate();
    for (const waiter of this.pending.values()) waiter.reject(new Error("audio worker was closed"));
    this.pending.clear();
  }

  private request(request: Omit<Extract<WorkerRequest, { kind: "analyse" }>, "id"> | Omit<Extract<WorkerRequest, { kind: "encode" }>, "id">): Promise<WorkerResponse> {
    const id = this.nextId++;
    const message = { ...request, id } as WorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(message, message.channels.map((channel) => channel.buffer));
    });
  }
}
