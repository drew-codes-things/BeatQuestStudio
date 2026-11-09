import type { SongIdentity } from "../import/songIdentity";
import type { ProjectSummary } from "../storage/projectStore";

export const DURATION_TOLERANCE_SECONDS = 1.5;

const COMBINING_ACCENTS = /[̀-ͯ]/g;
const NOT_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

export type ReadDurationSeconds = () => Promise<number | null>;

export function normalizeForMatch(text: string): string {
  return text.normalize("NFD").replace(COMBINING_ACCENTS, "").toLowerCase().replace(NOT_LETTER_OR_DIGIT, "");
}

function artistsAgree(projectArtist: string | null, wantedArtist: string): boolean {
  const have = normalizeForMatch(projectArtist ?? "");
  const want = normalizeForMatch(wantedArtist);
  return have === "" || want === "" || have === want;
}

function isMappedWithSameName(project: ProjectSummary, identity: SongIdentity): boolean {
  if (project.noteCount === 0 || project.songTitle === null) return false;
  const wantedTitle = normalizeForMatch(identity.title);
  return wantedTitle !== "" && normalizeForMatch(project.songTitle) === wantedTitle && artistsAgree(project.artist, identity.artist);
}

function lengthDifference(project: ProjectSummary, durationSeconds: number): number {
  return project.durationSeconds === null ? Number.POSITIVE_INFINITY : Math.abs(project.durationSeconds - durationSeconds);
}

export async function findAlreadyMade(known: readonly ProjectSummary[], identity: SongIdentity, readDurationSeconds: ReadDurationSeconds): Promise<ProjectSummary | null> {
  const sameName = known.filter((project) => isMappedWithSameName(project, identity));
  if (sameName.length === 0) return null;
  const durationSeconds = await readDurationSeconds();
  if (durationSeconds === null) return sameName[0] ?? null;
  const close = sameName.filter((project) => lengthDifference(project, durationSeconds) <= DURATION_TOLERANCE_SECONDS);
  return close.sort((left, right) => lengthDifference(left, durationSeconds) - lengthDifference(right, durationSeconds))[0] ?? null;
}
