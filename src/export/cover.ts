const COVER_SIZE = 512;
const TITLE_FONT = "bold 44px system-ui, sans-serif";
const ARTIST_FONT = "28px system-ui, sans-serif";
const MAX_TITLE_LINES = 3;
const TEXT_MARGIN = 40;

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

export async function generateCoverPng(title: string, artist: string): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_SIZE;
  canvas.height = COVER_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser cannot draw a cover image");
  const gradient = context.createLinearGradient(0, 0, COVER_SIZE, COVER_SIZE);
  gradient.addColorStop(0, "#3a0b12");
  gradient.addColorStop(0.5, "#0d0e12");
  gradient.addColorStop(1, "#0b1d3a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  context.save();
  context.translate(150, 170);
  context.rotate(-0.2);
  context.fillStyle = "#ff3b4e";
  context.fillRect(-60, -60, 120, 120);
  context.restore();
  context.save();
  context.translate(360, 230);
  context.rotate(0.2);
  context.fillStyle = "#3b8bff";
  context.fillRect(-60, -60, 120, 120);
  context.restore();
  context.fillStyle = "#ffffff";
  context.font = TITLE_FONT;
  const lines = wrapText(context, title || "Untitled", COVER_SIZE - TEXT_MARGIN * 2);
  lines.forEach((line, index) => context.fillText(line, TEXT_MARGIN, 360 + index * 50));
  context.fillStyle = "#c8cbd6";
  context.font = ARTIST_FONT;
  context.fillText(artist, TEXT_MARGIN, 360 + lines.length * 50 + 10);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not turn the cover into a PNG");
  return new Uint8Array(await blob.arrayBuffer());
}
