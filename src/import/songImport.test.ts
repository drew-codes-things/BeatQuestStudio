import { describe, expect, it, vi } from "vitest";
import type { AudioWorkerClient } from "../audio/workerProtocol";
import { MAX_SONG_SECONDS } from "../batch/limits";
import { readSongFile } from "./songImport";

const SAMPLE_RATE = 100;

function silentWav(seconds: number): Uint8Array {
  const dataBytes = seconds * SAMPLE_RATE;
  const wav = new Uint8Array(44 + dataBytes);
  const view = new DataView(wav.buffer);
  const text = (offset: number, value: string) => wav.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return wav;
}

function unusedWorker(): AudioWorkerClient {
  return {
    analyse: vi.fn(() => Promise.reject(new Error("analyse should not run"))),
    encodeOgg: vi.fn(() => Promise.reject(new Error("encodeOgg should not run"))),
  } as unknown as AudioWorkerClient;
}

describe("readSongFile", () => {
  it("refuses a song over the length limit before reading or decoding the whole file", async () => {
    const file = new File([silentWav(MAX_SONG_SECONDS + 60)], "long mix.wav", { type: "audio/wav" });
    const wholeFileRead = vi.spyOn(file, "arrayBuffer");
    const decodeAudioData = vi.fn(() => Promise.reject(new Error("decode should not run")));
    const context = { decodeAudioData } as unknown as BaseAudioContext;

    await expect(readSongFile(file, context, unusedWorker())).rejects.toThrow(/16 minutes long; songs are limited to 15 minutes/);
    expect(wholeFileRead).not.toHaveBeenCalled();
    expect(decodeAudioData).not.toHaveBeenCalled();
  });

  it("still decodes a song whose length cannot be read up front", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "mystery.mp3", { type: "audio/mpeg" });
    const decodeAudioData = vi.fn(() => Promise.reject(new Error("not audio")));
    const context = { decodeAudioData } as unknown as BaseAudioContext;

    await expect(readSongFile(file, context, unusedWorker())).rejects.toThrow(/could not read any audio/);
    expect(decodeAudioData).toHaveBeenCalledOnce();
  });
});
