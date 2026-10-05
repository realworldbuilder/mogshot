import type { Image } from '../formats/blp';

/*
 * Words over the picture: a title, and a smaller line under it. The words are drawn once on
 * a 2D canvas at the picture's size, then laid over the finished picture or over every
 * frame of a clip, so they sit above the character, the backdrop and the place alike.
 */

export interface Title {
  text: string;
  /** A smaller line under the title. */
  sub?: string;
  at: 'top' | 'bottom';
}

export const NO_TITLE: Title = { text: '', at: 'top' };

/** Whether there is anything to draw. */
export function hasTitle(title: Title | undefined): title is Title {
  return !!title && (title.text.trim() !== '' || (title.sub ?? '').trim() !== '');
}

/** The fonts are the computer's own: nothing is fetched. A bookish serif, as near the game's as most machines have. */
const FONT = "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif";
/** The game's title yellow, and the white of its smaller text. */
const TITLE_COLOUR = '#ffd100';
const SUB_COLOUR = '#ffffff';

/** The most of the picture's width a line may take. */
const LINE_WIDTH = 0.86;
/** A title is at most this many lines; words past them make the letters smaller instead. */
const MAX_LINES = 3;

/**
 * How far from the top or bottom edge the words keep, as a part of the height. An upright
 * picture (a Reel or a Story) keeps further away, clear of where phone apps lay their own
 * names and buttons: a rule of thumb, not a measurement of any app.
 */
export function titleMargin(width: number, height: number, at: Title['at']): number {
  const upright = height / width > 1.5;
  if (at === 'top') return upright ? 0.13 : 0.07;
  return upright ? 0.22 : 0.08;
}

/**
 * Break text into lines no wider than `maxWidth`, at spaces; a line break in the text is
 * kept. A single word wider than a line is left whole on its own line.
 */
export function wrapLines(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const longer = line ? `${line} ${word}` : word;
      if (line && measure(longer) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = longer;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** The words of a title, drawn: a band the picture's width, `top` rows down it. Premultiplied, like a frame. */
export interface TitleLayer extends Image {
  top: number;
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Lines of one size that fit: wrapped at the size asked for, then made smaller until no line is too wide and there are not too many. */
function fit(ctx: Context, text: string, size: number, weight: string, maxWidth: number): { lines: string[]; size: number } {
  for (let attempt = size; ; attempt = Math.floor(attempt * 0.92)) {
    ctx.font = `${weight} ${attempt}px ${FONT}`;
    const lines = wrapLines(text, maxWidth, (line) => ctx.measureText(line).width);
    const widest = Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
    if ((widest <= maxWidth && lines.length <= MAX_LINES) || attempt <= 8) return { lines, size: attempt };
  }
}

/**
 * Draw a title onto a canvas of the picture's size, which is otherwise left as it is.
 * Returns the rows the words may touch, or undefined when there are no words.
 */
export function drawTitle(canvas: Canvas, title: Title): { top: number; bottom: number } | undefined {
  if (!hasTitle(title)) return undefined;
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d') as Context | null;
  if (!ctx) throw new Error('This browser cannot draw a 2D canvas');
  // Sized by the shorter side, so a title is as large on an upright picture as on a wide one.
  const unit = Math.min(width, height);
  const maxWidth = width * LINE_WIDTH;
  const main = fit(ctx, title.text.trim(), Math.round(unit * 0.1), 'bold', maxWidth);
  const sub = fit(ctx, (title.sub ?? '').trim(), Math.round(unit * 0.05), 'normal', maxWidth);
  const rows = [
    ...main.lines.map((text) => ({ text, size: main.size, weight: 'bold', colour: TITLE_COLOUR })),
    ...sub.lines.map((text) => ({ text, size: sub.size, weight: 'normal', colour: SUB_COLOUR })),
  ];
  const leading = 1.18;
  const gap = main.lines.length > 0 && sub.lines.length > 0 ? sub.size * 0.35 : 0;
  const tall = rows.reduce((sum, row) => sum + row.size * leading, 0) + gap;
  const margin = titleMargin(width, height, title.at) * height;
  let y = title.at === 'top' ? margin : height - margin - tall;
  // The dark edge and the shadow reach a little past the letters.
  const reach = Math.ceil(main.size * 0.2 + sub.size * 0.2 + 4);
  const band = { top: Math.max(0, Math.floor(y - reach)), bottom: Math.min(height, Math.ceil(y + tall + reach)) };

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const [index, row] of rows.entries()) {
    if (index === main.lines.length) y += gap;
    const middle = y + (row.size * leading) / 2;
    ctx.font = `${row.weight} ${row.size}px ${FONT}`;
    // A dark edge and a soft shadow keep the words readable over anything.
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = row.size * 0.14;
    ctx.shadowOffsetY = row.size * 0.04;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = Math.max(2, row.size * 0.09);
    ctx.strokeText(row.text, width / 2, middle);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = row.colour;
    ctx.fillText(row.text, width / 2, middle);
    y += row.size * leading;
  }
  ctx.restore();
  return band;
}

/** A title drawn for a picture of the given size, ready to lay over it. Undefined when there are no words. */
export function composeTitle(title: Title | undefined, width: number, height: number): TitleLayer | undefined {
  if (!hasTitle(title)) return undefined;
  let canvas: Canvas;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const band = drawTitle(canvas, title);
  if (!band || band.bottom <= band.top) return undefined;
  const ctx = canvas.getContext('2d') as Context;
  const data = ctx.getImageData(0, band.top, width, band.bottom - band.top).data;
  const pixels = new Uint8Array(data.length);
  // A canvas hands back straight alpha; frames are premultiplied.
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!;
    pixels[i] = (data[i]! * alpha + 127) / 255;
    pixels[i + 1] = (data[i + 1]! * alpha + 127) / 255;
    pixels[i + 2] = (data[i + 2]! * alpha + 127) / 255;
    pixels[i + 3] = alpha;
  }
  return { width, height: band.bottom - band.top, pixels, top: band.top };
}

/** Lay a title over a premultiplied picture of the size it was drawn for, in place. */
export function layTitle(image: Image, title: TitleLayer | undefined): Image {
  if (!title) return image;
  if (title.width !== image.width || title.top + title.height > image.height) {
    throw new Error(`The title was drawn for a picture ${title.width} wide, not ${image.width} × ${image.height}`);
  }
  const under = image.pixels;
  const over = title.pixels;
  for (let i = 0, o = title.top * image.width * 4; i < over.length; i += 4, o += 4) {
    const alpha = over[i + 3]!;
    if (alpha === 0) continue;
    const keep = 255 - alpha;
    under[o] = over[i]! + (under[o]! * keep + 127) / 255;
    under[o + 1] = over[i + 1]! + (under[o + 1]! * keep + 127) / 255;
    under[o + 2] = over[i + 2]! + (under[o + 2]! * keep + 127) / 255;
    under[o + 3] = alpha + (under[o + 3]! * keep + 127) / 255;
  }
  return image;
}
