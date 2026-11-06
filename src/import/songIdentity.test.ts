import { describe, expect, it } from "vitest";
import { analyseSong } from "../audio/analysis";
import { makeClickTrack } from "../audio/testSignals";
import { DEFAULT_PROJECT_NAME, newProject } from "../core/model";
import { cleanSongName, readSongTags, songIdentity } from "./songIdentity";
import { withImportedSong } from "./songImport";

function riffChunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length % 2 === 1 ? 1 : 0;
  const chunk = new Uint8Array(8 + body.length + padded);
  chunk.set(new TextEncoder().encode(id), 0);
  new DataView(chunk.buffer).setUint32(4, body.length, true);
  chunk.set(body, 8);
  return chunk;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function zeroTerminated(text: string): Uint8Array {
  return concat([new TextEncoder().encode(text), new Uint8Array([0])]);
}

function taggedWav(title: string, artist: string): Uint8Array {
  const format = new Uint8Array(16);
  const view = new DataView(format.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 8000, true);
  view.setUint32(8, 16000, true);
  view.setUint16(12, 2, true);
  view.setUint16(14, 16, true);
  const info = concat([new TextEncoder().encode("INFO"), riffChunk("INAM", zeroTerminated(title)), riffChunk("IART", zeroTerminated(artist))]);
  const body = concat([new TextEncoder().encode("WAVE"), riffChunk("fmt ", format), riffChunk("LIST", info), riffChunk("data", new Uint8Array(1600))]);
  return riffChunk("RIFF", body);
}

describe("cleanSongName", () => {
  it.each([
    ["My_Song.mp3", "My Song", null],
    ["Daft Punk - One More Time (Official Video).mp4", "One More Time", "Daft Punk"],
    ["03_Test_Artist_-_Night_Drive_(Official_Video)_[HD].mp4", "Night Drive", "Test Artist"],
    ["01. Opening.flac", "Opening", null],
    ["Artist - Track [4K] (Lyrics).webm", "Track", "Artist"],
    ["Song Name (Remix).m4a", "Song Name (Remix)", null],
    ["Artist - Song (feat. Someone) (Official Audio) | Label.mp3", "Song (feat. Someone)", "Artist"],
    ["  spaced   out .wav", "spaced out", null],
    [".mp3", "Untitled", null],
  ])("%s", (fileName, title, artist) => {
    expect(cleanSongName(fileName)).toEqual({ title, artist });
  });
});

describe("songIdentity", () => {
  it("prefers tags, cleaned, over the file name", () => {
    expect(songIdentity({ title: "Real Title (Official Video)", artist: "Real Artist", picture: null }, "junk_file.mp3")).toEqual({ title: "Real Title", artist: "Real Artist" });
  });

  it("falls back to the file name for whatever the tags lack", () => {
    expect(songIdentity({ title: null, artist: "Tagged Artist", picture: null }, "Someone - Tune.mp3")).toEqual({ title: "Tune", artist: "Tagged Artist" });
    expect(songIdentity({ title: "  ", artist: null, picture: null }, "Someone - Tune.mp3")).toEqual({ title: "Tune", artist: "Someone" });
    expect(songIdentity({ title: null, artist: null, picture: null }, "Tune.mp3")).toEqual({ title: "Tune", artist: "" });
  });
});

describe("readSongTags", () => {
  it("reads the title and artist embedded in a file", async () => {
    const tags = await readSongTags(new Blob([taggedWav("Neon Skyline", "Fixture Band")], { type: "audio/wav" }));
    expect(tags.title).toBe("Neon Skyline");
    expect(tags.artist).toBe("Fixture Band");
    expect(tags.picture).toBeNull();
  });

  it("gives empty tags for a file it cannot parse, so the import still goes ahead", async () => {
    expect(await readSongTags(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }))).toEqual({ title: null, artist: null, picture: null });
  });
});

describe("withImportedSong identity", () => {
  const analysis = analyseSong([makeClickTrack({ bpm: 120, offsetSeconds: 0.5, durationSeconds: 20, sampleRate: 22050, accentEvery: 4, noiseLevel: 0.01 })], 22050);

  it("names a fresh project and its song after the identity", () => {
    const project = withImportedSong(newProject("p", DEFAULT_PROJECT_NAME, 1), { storedFileName: "a.mp3", identity: { title: "Night Drive", artist: "Test Artist" }, analysis }, 2);
    expect(project.name).toBe("Night Drive");
    expect(project.song?.title).toBe("Night Drive");
    expect(project.song?.artist).toBe("Test Artist");
  });

  it("keeps a name, title and artist the user already chose", () => {
    const first = withImportedSong(newProject("p", "My Map", 1), { storedFileName: "a.mp3", identity: { title: "A", artist: "B" }, analysis }, 2);
    const chosen = { ...first, song: { ...first.song!, title: "Kept", artist: "Mine" } };
    const again = withImportedSong(chosen, { storedFileName: "b.mp3", identity: { title: "Other", artist: "Else" }, analysis }, 3);
    expect(again.name).toBe("My Map");
    expect(again.song?.title).toBe("Kept");
    expect(again.song?.artist).toBe("Mine");
  });
});
