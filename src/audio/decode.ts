export const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".egg", ".opus", ".oga", ".flac", ".m4a", ".aac", ".weba"] as const;
export const VIDEO_EXTENSIONS = [".mp4", ".m4v", ".mov", ".webm", ".mkv"] as const;
export const IMPORT_ACCEPT = ["audio/*", "video/*", ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].join(",");

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

export function isVideoFile(fileName: string, mimeType: string): boolean {
  return mimeType.startsWith("video/") || (VIDEO_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

export function isSupportedImport(fileName: string, mimeType: string): boolean {
  const extension = extensionOf(fileName);
  return mimeType.startsWith("audio/") || isVideoFile(fileName, mimeType) || (AUDIO_EXTENSIONS as readonly string[]).includes(extension);
}

export function strippedAudioName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return `${dot < 0 ? fileName : fileName.slice(0, dot)}.ogg`;
}

export async function decodeAudio(context: BaseAudioContext, bytes: ArrayBuffer, fileName: string): Promise<AudioBuffer> {
  try {
    return await context.decodeAudioData(bytes.slice(0));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`could not read any audio from "${fileName}" (${reason}). Try MP3, WAV, OGG, Opus, FLAC, M4A, or an MP4/WebM video with a sound track.`);
  }
}

export function audioBufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}

