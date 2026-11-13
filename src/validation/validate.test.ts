import { describe, expect, it } from "vitest";
import { newProject, type Note, type Project } from "../core/model";
import { hasErrors, validateChart, validateProject } from "./validate";

function note(id: string, beat: number, x: number, y: number, color: Note["color"], direction: Note["direction"] = "down"): Note {
  return { id, beat, x, y, color, direction };
}

function projectWithSong(): Project {
  const project = newProject("p", "Test", 0);
  project.song = { title: "Song", subTitle: "", artist: "Artist", mapper: "Drew", fileName: "song.ogg", durationSeconds: 60, previewStartSeconds: 10, previewDurationSeconds: 10, beatDriftMs: 2 };
  return project;
}

function codes(project: Project, difficulty: "Easy" | "Normal" | "Hard" | "Expert" = "Expert") {
  return validateChart(project, difficulty).map((found) => found.code);
}

describe("project checks", () => {
  it("needs a song and at least one filled difficulty", () => {
    const issues = validateProject(newProject("p", "Empty", 0));
    expect(issues.map((found) => found.code)).toEqual(expect.arrayContaining(["no-song", "all-empty"]));
    expect(hasErrors(issues)).toBe(true);
  });

  it("warns about empty difficulties but does not block", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(note("a", 4, 1, 0, "red"));
    const issues = validateProject(project);
    expect(issues.filter((found) => found.code === "empty").map((found) => found.difficulty)).toEqual(["Easy", "Normal", "Hard", "ExpertPlus"]);
    expect(hasErrors(issues)).toBe(false);
  });

  it("warns when the beat grid drifts away from the music", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(note("a", 4, 1, 0, "red"));
    expect(validateProject(project).some((found) => found.code === "beat-drift")).toBe(false);
    project.song!.beatDriftMs = 40;
    expect(validateProject(project).find((found) => found.code === "beat-drift")?.message).toMatch(/40 ms/);
  });

  it("blocks export when the beat offset is not a finite number", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(note("a", 4, 1, 0, "red"));
    project.timing.offsetSeconds = Number.NaN;
    const issues = validateProject(project);
    expect(issues.find((found) => found.code === "offset")?.severity).toBe("error");
    expect(hasErrors(issues)).toBe(true);
  });

  it("warns when an easier difficulty has more notes", () => {
    const project = projectWithSong();
    project.charts.Easy.notes.push(note("a", 4, 1, 0, "red"), note("b", 8, 2, 0, "blue"));
    project.charts.Normal.notes.push(note("c", 4, 1, 0, "red"));
    expect(validateProject(project).some((found) => found.code === "difficulty-order")).toBe(true);
  });
});

describe("chart checks", () => {
  it("flags objects off the grid", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(note("a", 1, 4, 0, "red"), note("b", 2, 1, 0.5, "red"));
    expect(codes(project).filter((code) => code === "off-grid")).toHaveLength(2);
  });

  it("flags objects outside the song", () => {
    const project = projectWithSong();
    project.timing.offsetSeconds = 1;
    project.charts.Expert.notes.push(note("a", -3, 0, 0, "red"), note("b", 500, 3, 0, "blue"));
    expect(codes(project)).toEqual(expect.arrayContaining(["before-song", "after-song"]));
  });

  it("warns about objects in the first second", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(note("a", 1, 0, 0, "red"), note("b", 4, 3, 0, "blue"));
    expect(validateChart(project, "Expert").filter((found) => found.code === "too-early").map((found) => found.objectIds)).toEqual([["a"]]);
  });

  it("flags stacked objects and notes inside walls", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(note("a", 4, 0, 0, "red"), note("b", 4, 0, 0, "blue", "up"));
    project.charts.Expert.walls.push({ id: "w", beat: 3, x: 0, y: 0, durationBeats: 2, width: 1, height: 5 });
    expect(codes(project)).toEqual(expect.arrayContaining(["stacked", "inside-wall"]));
  });

  it("flags broken walls", () => {
    const project = projectWithSong();
    project.charts.Expert.walls.push(
      { id: "w1", beat: 3, x: 0, y: 0, durationBeats: 0, width: 1, height: 5 },
      { id: "w2", beat: 3, x: 3, y: 0, durationBeats: 1, width: 2, height: 5 },
      { id: "w3", beat: 3, x: 0, y: 0, durationBeats: 1, width: 1, height: 9 },
    );
    expect(codes(project)).toEqual(expect.arrayContaining(["wall-duration", "wall-width", "wall-height"]));
  });

  it("warns about vision blocks, crossovers and parity", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(
      note("v", 2, 1, 1, "red"),
      note("r", 8, 3, 0, "red"),
      note("b", 8, 0, 0, "blue", "up"),
      note("r2", 9, 0, 0, "red", "downLeft"),
    );
    expect(codes(project)).toEqual(expect.arrayContaining(["vision-block", "crossover", "parity"]));
  });

  it("allows the same swing again after a rest", () => {
    const project = projectWithSong();
    project.charts.Easy.notes.push(note("a", 4, 0, 0, "red"), note("b", 12, 0, 0, "red"));
    expect(codes(project, "Easy")).not.toContain("parity");
  });

  it("does not change the map", () => {
    const project = projectWithSong();
    project.charts.Expert.notes.push(note("a", 1, 9, 9, "red"));
    const before = structuredClone(project);
    validateProject(project);
    expect(project).toEqual(before);
  });
});
