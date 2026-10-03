import type { Image } from '../formats/blp';

/*
 * What goes behind the character. A backdrop is composed on a 2D canvas at the picture's
 * size, then drawn under the character by the renderer (so glows blend over it exactly)
 * or saved on its own for layering in an editor.
 */

export type Backdrop =
  | { kind: 'none' }
  | { kind: 'colour'; colour: string; vignette: number }
  | { kind: 'gradient'; from: string; to: string; shape: 'radial' | 'vertical'; vignette: number }
  | { kind: 'screen'; fileId: number; blur: number; vignette: number };

export const NO_BACKDROP: Backdrop = { kind: 'none' };

/** Named two-colour gradients: `from` sits behind the character (the centre, or the top), `to` at the edges (or the bottom). */
export const GRADIENTS = [
  { name: 'Slate', from: '#5b6475', to: '#15181f' },
  { name: 'Ember', from: '#d3652a', to: '#2a0c05' },
  { name: 'Frost', from: '#6fb6e6', to: '#0b1a33' },
  { name: 'Fel', from: '#5fcf5a', to: '#06160b' },
  { name: 'Gold', from: '#e3b341', to: '#2a1a05' },
  { name: 'Arcane', from: '#9b6cf0', to: '#140a2b' },
  { name: 'Forest', from: '#4f8a3c', to: '#0c1a0a' },
  { name: 'Blood', from: '#b8262b', to: '#1c0507' },
] as const;

/** The ranges the sliders use. Blur is in pixels of a 1080-pixel-tall picture; vignette is 0..1. */
export const MAX_BLUR = 40;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a source picture that fills a target of another shape, like CSS `object-fit: cover`. */
export function coverFit(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): Rect {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = targetWidth / scale;
  const height = targetHeight / scale;
  return { x: (sourceWidth - width) / 2, y: (sourceHeight - height) / 2, width, height };
}

/**
 * A picture as the game shows a loading screen: over black, so that transparent parts
 * (the letterbox bars of the wide screens) come out black and opaque.
 */
export function overBlack(image: Image): Image {
  const pixels = new Uint8Array(image.pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = image.pixels[i + 3]!;
    pixels[i] = (image.pixels[i]! * alpha + 127) / 255;
    pixels[i + 1] = (image.pixels[i + 1]! * alpha + 127) / 255;
    pixels[i + 2] = (image.pixels[i + 2]! * alpha + 127) / 255;
    pixels[i + 3] = 255;
  }
  return { width: image.width, height: image.height, pixels };
}

/**
 * The part of a picture inside its black borders: the wide loading screens have letterbox
 * bars. Rows and columns whose brightest sampled pixel is at most `dark` are trimmed from
 * each edge.
 */
export function trimDark(image: Image, dark = 24): Rect {
  const { width, height, pixels } = image;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 256));
  const bright = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > dark;
  };
  const rowLit = (y: number) => {
    for (let x = 0; x < width; x += step) if (bright(x, y)) return true;
    return false;
  };
  const columnLit = (x: number) => {
    for (let y = 0; y < height; y += step) if (bright(x, y)) return true;
    return false;
  };
  let top = 0;
  let bottom = height;
  let left = 0;
  let right = width;
  while (top < bottom - 1 && !rowLit(top)) top++;
  while (bottom > top + 1 && !rowLit(bottom - 1)) bottom--;
  while (left < right - 1 && !columnLit(left)) left++;
  while (right > left + 1 && !columnLit(right - 1)) right--;
  // An all-dark picture is kept whole.
  if (bottom - top < height / 4 || right - left < width / 4) return { x: 0, y: 0, width, height };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The shape the game shows a classic loading screen at: the file is a square, stretched. */
export const CLASSIC_SCREEN_ASPECT = 4 / 3;

/**
 * The art in a classic loading screen: a band across the file between parchment borders,
 * with the game's logo over its top. The band below the logo is what is shown.
 */
export function classicArt(image: Image): Rect {
  const top = Math.round(image.height * 0.23);
  const bottom = Math.round(image.height * 0.82);
  return { x: 0, y: top, width: image.width, height: bottom - top };
}

/**
 * Draw a backdrop at the given size. `image` is the loading screen's pixels when the kind
 * is `screen`, and `imageAspect` the width over height it is meant to be shown at, when
 * that is not the file's own. The result is opaque. Returns undefined for no backdrop.
 */
export function composeBackdrop(spec: Backdrop, width: number, height: number, image?: Image, imageAspect?: number): Canvas | undefined {
  if (spec.kind === 'none') return undefined;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d') as Context | null;
  if (!ctx) throw new Error('This browser cannot draw a 2D canvas');

  switch (spec.kind) {
    case 'colour':
      ctx.fillStyle = spec.colour;
      ctx.fillRect(0, 0, width, height);
      break;
    case 'gradient': {
      let gradient: CanvasGradient;
      if (spec.shape === 'radial') {
        // A soft light behind the character, a little above the middle.
        const radius = Math.hypot(width, height) * 0.55;
        gradient = ctx.createRadialGradient(width / 2, height * 0.42, 0, width / 2, height * 0.42, radius);
        gradient.addColorStop(0, spec.from);
        gradient.addColorStop(1, spec.to);
      } else {
        gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, spec.from);
        gradient.addColorStop(1, spec.to);
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'screen': {
      if (!image) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        break;
      }
      const flat = overBlack(image);
      const source = makeCanvas(flat.width, flat.height);
      const sourceContext = source.getContext('2d') as Context;
      sourceContext.putImageData(new ImageData(new Uint8ClampedArray(flat.pixels), flat.width, flat.height), 0, 0);
      // Blur fades to transparent at the edges, so draw past them by the blur's reach.
      const blur = (spec.blur * height) / 1080;
      const pad = Math.ceil(blur * 2);
      // The art: a classic screen's band below the logo, or a wide screen inside its black bars.
      // Crop it in the shape it is shown at, then map back to the file's pixels.
      const inside = imageAspect ? classicArt(flat) : trimDark(flat);
      const stretch = imageAspect ? (flat.height * imageAspect) / flat.width : 1;
      const crop = coverFit(inside.width * stretch, inside.height, width + 2 * pad, height + 2 * pad);
      ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
      ctx.drawImage(
        source, inside.x + crop.x / stretch, inside.y + crop.y, crop.width / stretch, crop.height,
        -pad, -pad, width + 2 * pad, height + 2 * pad,
      );
      ctx.filter = 'none';
      break;
    }
  }

  if (spec.vignette > 0) {
    const radius = Math.hypot(width, height) / 2;
    const shade = ctx.createRadialGradient(width / 2, height / 2, radius * 0.35, width / 2, height / 2, radius);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, `rgba(0, 0, 0, ${Math.min(1, spec.vignette)})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

/** The composed backdrop's pixels as a straight-alpha image, for saving on its own. */
export function backdropImage(canvas: Canvas): Image {
  const ctx = canvas.getContext('2d') as Context;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, pixels: new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength) };
}

/** A short name for a file: letters and digits, hyphenated. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
