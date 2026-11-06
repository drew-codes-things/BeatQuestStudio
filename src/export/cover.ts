import type { EmbeddedPicture } from "../import/songIdentity";

export const AUTO_COVER_FILE_NAME = "auto-cover.png";

const COVER_SIZE = 512;
const FONT_FAMILY = '"IBM Plex Sans", system-ui, sans-serif';
const TITLE_FONT = `700 44px ${FONT_FAMILY}`;
const ARTIST_FONT = `500 26px ${FONT_FAMILY}`;
const BADGE_FONT = `700 20px ${FONT_FAMILY}`;
const MAX_TITLE_LINES = 3;
const TEXT_MARGIN = 40;
const TITLE_TOP = 330;
const TITLE_LINE_HEIGHT = 50;
const BADGE_MARGIN = 18;
const BADGE_PADDING_X = 12;
const BADGE_HEIGHT = 34;
const BADGE_RADIUS = 9;
const SIGNAL_RED = "#e5383b";
const NOTE_BLUE = "#3b8bff";

interface NoteBlock {
  x: number;
  y: number;
  size: number;
  angle: number;
  color: string;
}

const NOTE_BLOCKS: readonly NoteBlock[] = [
  { x: 150, y: 165, size: 118, angle: -0.2, color: SIGNAL_RED },
  { x: 350, y: 215, size: 104, angle: 0.22, color: NOTE_BLUE },
  { x: 430, y: 95, size: 52, angle: -0.35, color: SIGNAL_RED },
];

function newCanvas(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_SIZE;
  canvas.height = COVER_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser cannot draw a cover image");
  return { canvas, context };
}

async function loadCoverFonts(): Promise<void> {
  if (!("fonts" in document)) return;
  await Promise.all([document.fonts.load(TITLE_FONT), document.fonts.load(ARTIST_FONT), document.fonts.load(BADGE_FONT)]);
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, MAX_TITLE_LINES);
}

function paintBackground(context: CanvasRenderingContext2D): void {
  const base = context.createLinearGradient(0, 0, COVER_SIZE * 0.4, COVER_SIZE);
  base.addColorStop(0, "#1c0608");
  base.addColorStop(0.45, "#0d0b0c");
  base.addColorStop(1, "#070708");
  context.fillStyle = base;
  context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  const glow = context.createRadialGradient(0, 0, 0, 0, 0, COVER_SIZE * 0.9);
  glow.addColorStop(0, "rgba(160, 20, 28, 0.55)");
  glow.addColorStop(1, "rgba(160, 20, 28, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
}

function paintNoteBlock(context: CanvasRenderingContext2D, block: NoteBlock): void {
  const half = block.size / 2;
  context.save();
  context.translate(block.x, block.y);
  context.rotate(block.angle);
  context.shadowColor = block.color;
  context.shadowBlur = 28;
  context.fillStyle = block.color;
  context.beginPath();
  context.roundRect(-half, -half, block.size, block.size, block.size * 0.14);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(-half * 0.55, -half * 0.25);
  context.lineTo(half * 0.55, -half * 0.25);
  context.lineTo(0, half * 0.4);
  context.closePath();
  context.fill();
  context.restore();
}

function paintTitle(context: CanvasRenderingContext2D, title: string, artist: string): void {
  context.textBaseline = "alphabetic";
  context.fillStyle = "#ececec";
  context.font = TITLE_FONT;
  const lines = wrapText(context, title || "Untitled", COVER_SIZE - TEXT_MARGIN * 2);
  lines.forEach((line, index) => context.fillText(line, TEXT_MARGIN, TITLE_TOP + index * TITLE_LINE_HEIGHT));
  if (!artist) return;
  context.fillStyle = "#a1a1a6";
  context.font = ARTIST_FONT;
  context.fillText(artist, TEXT_MARGIN, TITLE_TOP + lines.length * TITLE_LINE_HEIGHT + 4, COVER_SIZE - TEXT_MARGIN * 2);
}

function paintBadge(context: CanvasRenderingContext2D): void {
  context.font = BADGE_FONT;
  context.textBaseline = "middle";
  const first = "Drew";
  const second = "Beat";
  const firstWidth = context.measureText(first).width;
  const width = firstWidth + context.measureText(second).width + BADGE_PADDING_X * 2;
  const left = COVER_SIZE - BADGE_MARGIN - width;
  const top = COVER_SIZE - BADGE_MARGIN - BADGE_HEIGHT;
  context.fillStyle = "rgba(7, 7, 8, 0.82)";
  context.strokeStyle = "rgba(229, 56, 59, 0.85)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.roundRect(left, top, width, BADGE_HEIGHT, BADGE_RADIUS);
  context.fill();
  context.stroke();
  context.fillStyle = "#ffffff";
  context.fillText(first, left + BADGE_PADDING_X, top + BADGE_HEIGHT / 2 + 1);
  context.fillStyle = SIGNAL_RED;
  context.fillText(second, left + BADGE_PADDING_X + firstWidth, top + BADGE_HEIGHT / 2 + 1);
}

function paintPicture(context: CanvasRenderingContext2D, picture: ImageBitmap): void {
  const scale = Math.max(COVER_SIZE / picture.width, COVER_SIZE / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  context.fillStyle = "#070708";
  context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  context.drawImage(picture, (COVER_SIZE - width) / 2, (COVER_SIZE - height) / 2, width, height);
  const shade = context.createLinearGradient(0, COVER_SIZE * 0.7, 0, COVER_SIZE);
  shade.addColorStop(0, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  context.fillStyle = shade;
  context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not turn the cover into a PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

export async function generateCoverPng(title: string, artist: string): Promise<Uint8Array> {
  await loadCoverFonts();
  const { canvas, context } = newCanvas();
  paintBackground(context);
  for (const block of NOTE_BLOCKS) paintNoteBlock(context, block);
  paintTitle(context, title, artist);
  paintBadge(context);
  return toPng(canvas);
}

async function decodePicture(picture: EmbeddedPicture): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(new Blob([picture.data], { type: picture.mimeType }));
  } catch {
    return null;
  }
}

export async function makeAutoCover(picture: EmbeddedPicture | null, title: string, artist: string): Promise<Uint8Array> {
  const decoded = picture ? await decodePicture(picture) : null;
  if (!decoded) return generateCoverPng(title, artist);
  await loadCoverFonts();
  const { canvas, context } = newCanvas();
  paintPicture(context, decoded);
  decoded.close();
  paintBadge(context);
  return toPng(canvas);
}
