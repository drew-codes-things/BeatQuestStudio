import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { difficultyLabel, newProject, type Project } from "../core/model";
import { isOggVorbis, encodeOggVorbis } from "./audio";
import { buildDifficulty, buildInfo, exportBeat, mapFolderName } from "./beatmap";
import { buildMapFiles, coverFileNameFor, zipMapFiles } from "./package";

function project(): Project {
  const result = newProject("abcdef123456", "My map", 0);
  result.timing = { bpm: 120, offsetSeconds: 0.25 };
  result.song = { title: "Song: Title?", subTitle: "Live", artist: "Band", mapper: "Drew", fileName: "song.mp3", durationSeconds: 60, previewStartSeconds: 12, previewDurationSeconds: 10, beatDriftMs: null };
  result.charts.Expert.notes.push({ id: "n", beat: 4, x: 1, y: 0, color: "blue", direction: "downLeft" });
  result.charts.Expert.bombs.push({ id: "b", beat: 6, x: 2, y: 2 });
  result.charts.Expert.walls.push({ id: "w", beat: 8, x: 0, y: 0, durationBeats: 2, width: 1, height: 5 });
  result.charts.Expert.arcs.push({ id: "a", beat: 10, x: 1, y: 0, color: "red", direction: "down", headMultiplier: 1, tailBeat: 11, tailX: 1, tailY: 2, tailDirection: "up", tailMultiplier: 1 });
  result.charts.Expert.chains.push({ id: "c", beat: 12, x: 3, y: 2, color: "blue", direction: "down", tailBeat: 12.25, tailX: 3, tailY: 0, segments: 5, squish: 1 });
  result.charts.Easy.notes.push({ id: "e", beat: 4, x: 1, y: 0, color: "red", direction: "down" });
  return result;
}

describe("difficulty files", () => {
  it("shifts beats so beat 0 lines up with the start of the audio", () => {
    expect(exportBeat(4, { bpm: 120, offsetSeconds: 0.25 })).toBe(4.5);
  });

  it("writes every object type in v3.3.0 form", () => {
    const file = buildDifficulty(project().charts.Expert, project().timing);
    expect(file.version).toBe("3.3.0");
    expect(file.colorNotes).toEqual([{ b: 4.5, x: 1, y: 0, a: 0, c: 1, d: 6 }]);
    expect(file.bombNotes).toEqual([{ b: 6.5, x: 2, y: 2 }]);
    expect(file.obstacles).toEqual([{ b: 8.5, x: 0, y: 0, d: 2, w: 1, h: 5 }]);
    expect(file.sliders).toEqual([{ b: 10.5, c: 0, x: 1, y: 0, d: 1, mu: 1, tb: 11.5, tx: 1, ty: 2, tc: 0, tmu: 1, m: 0 }]);
    expect(file.burstSliders).toEqual([{ b: 12.5, c: 1, x: 3, y: 2, d: 1, tb: 12.75, tx: 3, ty: 0, sc: 5, s: 1 }]);
    expect((file.basicBeatmapEvents as unknown[]).length).toBeGreaterThan(0);
  });

  it("has the same top-level keys as a v3.3.0 map that plays on the Quest", () => {
    const keys = Object.keys(buildDifficulty(project().charts.Expert, project().timing));
    expect(keys).toEqual(expect.arrayContaining([
      "version", "bpmEvents", "rotationEvents", "basicBeatmapEvents", "colorBoostBeatmapEvents", "colorNotes", "bombNotes",
      "obstacles", "sliders", "burstSliders", "waypoints", "lightColorEventBoxGroups", "lightRotationEventBoxGroups",
      "lightTranslationEventBoxGroups", "vfxEventBoxGroups", "_fxEventsCollection", "basicEventTypesWithKeywords", "useNormalEventsAsCompatibleEvents",
    ]));
  });
});

describe("Info.dat", () => {
  it("lists only filled difficulties with their ranks and files", () => {
    const info = buildInfo(project(), "cover.png");
    expect(info._version).toBe("2.1.0");
    expect(info._beatsPerMinute).toBe(120);
    expect(info._songTimeOffset).toBe(0);
    const sets = info._difficultyBeatmapSets as { _beatmapCharacteristicName: string; _difficultyBeatmaps: Record<string, unknown>[] }[];
    expect(sets.map((set) => set._beatmapCharacteristicName)).toEqual(["Standard"]);
    expect(sets[0]!._difficultyBeatmaps.map((entry) => [entry._difficulty, entry._difficultyRank, entry._beatmapFilename, entry._noteJumpMovementSpeed]))
      .toEqual([["Easy", 1, "EasyStandard.dat", 10], ["Expert", 7, "ExpertStandard.dat", 16]]);
  });

  it("exports Expert+ as Beat Saber's ExpertPlus, ranked above Expert", () => {
    const withExpertPlus = project();
    withExpertPlus.charts.ExpertPlus.notes.push({ id: "e", beat: 4, x: 2, y: 0, color: "blue", direction: "down" });
    const sets = buildInfo(withExpertPlus, "cover.png")._difficultyBeatmapSets as { _difficultyBeatmaps: Record<string, unknown>[] }[];
    expect(sets[0]!._difficultyBeatmaps.at(-1)).toMatchObject({ _difficulty: "ExpertPlus", _difficultyRank: 9, _beatmapFilename: "ExpertPlusStandard.dat", _noteJumpMovementSpeed: 18 });
    expect(Object.keys(buildMapFiles(withExpertPlus, new Uint8Array([1]), { fileName: "cover.png", bytes: new Uint8Array([2]) }))).toContain("ExpertPlusStandard.dat");
    expect(difficultyLabel("ExpertPlus")).toBe("Expert+");
    expect(difficultyLabel("Hard")).toBe("Hard");
  });

  it("refuses to build without a song", () => {
    expect(() => buildInfo(newProject("x", "x", 0), "cover.png")).toThrow(/without a song/);
  });
});

describe("folder and zip", () => {
  it("makes a folder name the Quest file system accepts", () => {
    expect(mapFolderName(project())).toBe("abcdef (Song Title - Drew)");
    const tricky = project();
    tricky.song!.title = "It's $(rm -rf) `x`; Ünïcode/..";
    expect(mapFolderName(tricky)).toBe("abcdef (Its (rm -rf) x Ünïcode - Drew)");
  });

  it("picks the cover file name from the upload", () => {
    expect(coverFileNameFor("Art.JPEG")).toBe("cover.jpg");
    expect(coverFileNameFor("art.webp")).toBe("cover.png");
  });

  it("zips Info.dat, the song, the cover and each filled difficulty", () => {
    const files = buildMapFiles(project(), new Uint8Array([1, 2]), { fileName: "cover.png", bytes: new Uint8Array([3]) });
    const unzipped = unzipSync(zipMapFiles(files));
    expect(Object.keys(unzipped).sort()).toEqual(["EasyStandard.dat", "ExpertStandard.dat", "Info.dat", "cover.png", "song.egg"]);
    const info = JSON.parse(new TextDecoder().decode(unzipped["Info.dat"]));
    expect(info._songFilename).toBe("song.egg");
    expect(info._coverImageFilename).toBe("cover.png");
  });

  it("refuses to export a project with every difficulty empty", () => {
    const empty = newProject("x", "x", 0);
    empty.song = project().song;
    expect(() => buildMapFiles(empty, new Uint8Array(), { fileName: "cover.png", bytes: new Uint8Array() })).toThrow(/every difficulty is empty/);
  });
});

describe("audio", () => {
  it("encodes Ogg Vorbis that it then recognises", async () => {
    const sampleRate = 44100;
    const tone = new Float32Array(sampleRate);
    for (let index = 0; index < tone.length; index += 1) tone[index] = 0.3 * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    const encoded = await encodeOggVorbis([tone, tone], sampleRate);
    expect(encoded.length).toBeGreaterThan(1000);
    expect(isOggVorbis(encoded)).toBe(true);
  });

  it("does not mistake other formats for Ogg Vorbis", () => {
    const fake = new Uint8Array(200);
    fake.set(new TextEncoder().encode("OggS"), 0);
    fake.set(new TextEncoder().encode("OpusHead"), 28);
    expect(isOggVorbis(fake)).toBe(false);
    expect(isOggVorbis(new Uint8Array(200))).toBe(false);
  });
});
