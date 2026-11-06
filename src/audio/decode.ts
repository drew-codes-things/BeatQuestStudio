export const SUPPORTED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".egg"] as const;

export function isSupportedAudioFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export async function decodeAudio(context: BaseAudioContext, bytes: ArrayBuffer, fileName: string): Promise<AudioBuffer> {
  try {
    return await context.decodeAudioData(bytes.slice(0));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`could not decode "${fileName}" as audio (${reason}). Use an MP3, WAV or OGG file.`);
  }
}

export function audioBufferChannels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
}

export function mimeTypeForAudio(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "audio/ogg";
}
