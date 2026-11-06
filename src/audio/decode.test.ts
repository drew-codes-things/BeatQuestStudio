import { describe, expect, it } from "vitest";
import { isSupportedImport, isVideoFile, strippedAudioName } from "./decode";

describe("import file types", () => {
  it.each(["a.mp3", "a.WAV", "a.ogg", "a.egg", "a.opus", "a.flac", "a.m4a", "a.aac", "clip.mp4", "clip.mov", "clip.webm"])("accepts %s", (name) => {
    expect(isSupportedImport(name, "")).toBe(true);
  });

  it("trusts the browser's media type when the name has no extension", () => {
    expect(isSupportedImport("recording", "audio/x-something")).toBe(true);
    expect(isSupportedImport("clip", "video/quicktime")).toBe(true);
    expect(isSupportedImport("notes.txt", "text/plain")).toBe(false);
  });

  it("treats video files as needing their sound stripped out", () => {
    expect(isVideoFile("clip.MP4", "")).toBe(true);
    expect(isVideoFile("song.mp3", "audio/mpeg")).toBe(false);
    expect(strippedAudioName("My Clip.final.mp4")).toBe("My Clip.final.ogg");
  });
});
