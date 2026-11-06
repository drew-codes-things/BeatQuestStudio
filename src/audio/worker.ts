import { encodeOggVorbis } from "../export/audio";
import { analyseSong, computePeaks, mixToMono } from "./analysis";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

const PEAK_BUCKETS_PER_SECOND = 200;

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

async function handle(request: WorkerRequest): Promise<{ response: WorkerResponse; transfer: Transferable[] }> {
  if (request.kind === "analyse") {
    const analysis = analyseSong(request.channels, request.sampleRate);
    const peaks = computePeaks(mixToMono(request.channels), request.sampleRate, Math.max(1, Math.round(request.sampleRate / PEAK_BUCKETS_PER_SECOND)));
    return {
      response: { id: request.id, ok: true, kind: "analyse", analysis, peaks },
      transfer: [analysis.energy.buffer, analysis.attack.rise.buffer, peaks.min.buffer, peaks.max.buffer],
    };
  }
  const bytes = await encodeOggVorbis(request.channels, request.sampleRate);
  return { response: { id: request.id, ok: true, kind: "encode", bytes }, transfer: [bytes.buffer] };
}

scope.onmessage = (event) => {
  handle(event.data)
    .then(({ response, transfer }) => scope.postMessage(response, transfer))
    .catch((cause: unknown) => scope.postMessage({ id: event.data.id, ok: false, error: cause instanceof Error ? cause.message : String(cause) }, []));
};
