import { parseBlob } from "music-metadata";

export interface EmbeddedPicture {
  data: Uint8Array;
  mimeType: string;
}

export interface SongTags {
  title: string | null;
  artist: string | null;
  picture: EmbeddedPicture | null;
}

export interface SongIdentity {
  title: string;
  artist: string;
}

export interface CleanedName {
  title: string;
  artist: string | null;
}

const UNTITLED = "Untitled";
const NO_TAGS: SongTags = { title: null, artist: null, picture: null };
const JUNK_WORDS = /\b(official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|1080p|720p|mv|m\/v|full song|free download)\b/i;
const BRACKETED = /\s*[([]([^()[\]]*)[)\]]/g;
const TRAILING_PIPE = /\s+\|.*$/;
const LEADING_TRACK_NUMBER = /^\d{1,3}(?:\s*[.)]\s*|\s*-\s+|\s+(?=.+\s-\s))/;
const ARTIST_SEPARATOR = " - ";

function withoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(0, dot) : fileName;
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripJunk(text: string): string {
  const noJunkBrackets = text.replace(BRACKETED, (whole, inside: string) => (JUNK_WORDS.test(inside) ? "" : whole));
  return collapseSpaces(noJunkBrackets.replace(TRAILING_PIPE, ""));
}

export function cleanSongName(fileName: string): CleanedName {
  const readable = collapseSpaces(withoutExtension(fileName).replace(/_+/g, " "));
  const cleaned = stripJunk(readable).replace(LEADING_TRACK_NUMBER, "");
  const separator = cleaned.indexOf(ARTIST_SEPARATOR);
  if (separator > 0 && separator + ARTIST_SEPARATOR.length < cleaned.length) {
    return { artist: cleaned.slice(0, separator).trim(), title: cleaned.slice(separator + ARTIST_SEPARATOR.length).trim() };
  }
  return { title: cleaned || UNTITLED, artist: null };
}

function usable(text: string | null): string | null {
  const cleaned = text === null ? "" : stripJunk(text);
  return cleaned ? cleaned : null;
}

export function songIdentity(tags: SongTags, fileName: string): SongIdentity {
  const fromName = cleanSongName(fileName);
  return {
    title: usable(tags.title) ?? fromName.title,
    artist: usable(tags.artist) ?? fromName.artist ?? "",
  };
}

export async function readSongTags(file: Blob): Promise<SongTags> {
  try {
    const { common } = await parseBlob(file, { duration: false, skipCovers: false });
    const picture = common.picture?.[0];
    return {
      title: common.title ?? null,
      artist: common.artist ?? null,
      picture: picture ? { data: picture.data, mimeType: picture.format } : null,
    };
  } catch {
    return NO_TAGS;
  }
}

export async function readSongDurationSeconds(file: Blob): Promise<number | null> {
  try {
    const { format } = await parseBlob(file, { duration: true, skipCovers: true });
    return typeof format.duration === "number" && Number.isFinite(format.duration) ? format.duration : null;
  } catch {
    return null;
  }
}
