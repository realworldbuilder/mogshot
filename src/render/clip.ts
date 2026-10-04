import { zipSync } from 'fflate';
import type { Image } from '../formats/blp';
import { encodePng, unpremultiply } from './export';

/*
 * A clip: the character drawn at evenly spaced moments of an animation and written as one
 * file. Frames are drawn at exact times rather than recorded as they play, so a clip is the
 * same every time and never drops a frame.
 */

/** `mp4` (H.264 with a silent sound track) and `gif` are opaque (transparency becomes black); `frames` is a zip of transparent PNGs. */
export type ClipFormat = 'mp4' | 'gif' | 'frames';

export const CLIP_FORMATS: Record<ClipFormat, { name: string; extension: string; type: string }> = {
  mp4: { name: 'MP4 video', extension: 'mp4', type: 'video/mp4' },
  gif: { name: 'GIF', extension: 'gif', type: 'image/gif' },
  frames: { name: 'PNG frames (transparent)', extension: 'zip', type: 'application/zip' },
};

/** Frames a second in a video or a set of frames. */
export const CLIP_FPS = 30;

/** A GIF times its frames in hundredths of a second, so only some rates are exact. */
export const GIF_FPS = 25;

/**
 * The moment of the animation each frame shows, in milliseconds. Without `seconds` the clip
 * is one pass of the animation, spaced so that the frame after the last would be the first
 * again: it loops without a seam. A longer clip goes round the animation again.
 */
export function clipTimes(durationMs: number, fps: number, seconds?: number): number[] {
  if (!(durationMs > 0) || !(fps > 0)) return [0];
  if (seconds === undefined) {
    const count = Math.max(1, Math.round((durationMs * fps) / 1000));
    return Array.from({ length: count }, (_, i) => (i * durationMs) / count);
  }
  const count = Math.max(1, Math.round(seconds * fps));
  return Array.from({ length: count }, (_, i) => ((i * 1000) / fps) % durationMs);
}

/**
 * The moments for a clip of about `seconds` that still loops without a seam: the animation
 * played a whole number of times, the number that comes nearest to the length asked for.
 */
export function loopedTimes(durationMs: number, fps: number, seconds: number): number[] {
  const once = clipTimes(durationMs, fps);
  if (!(durationMs > 0)) return once;
  const loops = Math.max(1, Math.round((seconds * 1000) / durationMs));
  return Array.from({ length: loops }, () => once).flat();
}

/**
 * RGBA as the planes a video holds: brightness at full size, then the two colour planes at
 * half size each way, in the standard (BT.709, limited range) form players and sites expect.
 * Alpha is ignored: premultiplied colour over nothing is the colour over black.
 */
export function toI420(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height + 2 * (width / 2) * (height / 2));
  const halfWidth = width / 2;
  const uAt = width * height;
  const vAt = uAt + halfWidth * (height / 2);
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      let red = 0;
      let blue = 0;
      let luma = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const p = ((y + dy) * width + x + dx) * 4;
          const r = pixels[p]!;
          const b = pixels[p + 2]!;
          const l = 0.2126 * r + 0.7152 * pixels[p + 1]! + 0.0722 * b;
          out[(y + dy) * width + x + dx] = 16 + (219 / 255) * l + 0.5;
          red += r;
          blue += b;
          luma += l;
        }
      }
      const at = (y / 2) * halfWidth + x / 2;
      out[uAt + at] = 128 + ((224 / 255) * (blue - luma)) / (4 * 1.8556) + 0.5;
      out[vAt + at] = 128 + ((224 / 255) * (red - luma)) / (4 * 1.5748) + 0.5;
    }
  }
  return out;
}

/** Video sizes must be even in both directions. */
export function evenSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(2, Math.round(width / 2) * 2), height: Math.max(2, Math.round(height / 2) * 2) };
}

/**
 * Pixel size of a clip for a picture shape: the same shape, no larger than 1080p video
 * (a GIF no larger than 800 pixels), with the even sides video needs.
 */
export function clipSize(size: { width: number; height: number }, gif = false): { width: number; height: number } {
  const long = Math.max(size.width, size.height);
  const short = Math.min(size.width, size.height);
  const scale = gif ? Math.min(1, 800 / long) : Math.min(1, 1920 / long, 1080 / short);
  return { width: Math.round((size.width * scale) / 2) * 2, height: Math.round((size.height * scale) / 2) * 2 };
}

export interface ClipOptions {
  format: ClipFormat;
  width: number;
  height: number;
  fps: number;
  frames: number;
  /** Draws a frame: premultiplied RGBA, rows top to bottom, exactly width x height. */
  frame: (index: number) => Promise<Image>;
  onProgress?: (done: number, of: number) => void;
}

/** Draw every frame and encode them as one file. */
export async function encodeClip(options: ClipOptions): Promise<Uint8Array> {
  const { format, width, height, frames } = options;
  const each = async (use: (image: Image, index: number) => Promise<void> | void) => {
    for (let i = 0; i < frames; i++) {
      const image = await options.frame(i);
      if (image.width !== width || image.height !== height) {
        throw new Error(`Frame ${i + 1} is ${image.width} × ${image.height}, not ${width} × ${height}`);
      }
      await use(image, i);
      options.onProgress?.(i + 1, frames);
    }
  };
  if (format === 'mp4') return encodeMp4(options, each);
  if (format === 'gif') return encodeGif(options, each);

  const files: Record<string, Uint8Array> = {};
  await each(async (image, i) => {
    unpremultiply(image.pixels);
    files[`frame-${String(i + 1).padStart(4, '0')}.png`] = await encodePng(image);
  });
  // PNGs are already compressed; the zip only holds them together.
  return zipSync(files, { level: 0 });
}

type Each = (use: (image: Image, index: number) => Promise<void> | void) => Promise<void>;

async function encodeMp4({ width, height, fps, frames }: ClipOptions, each: Each): Promise<Uint8Array> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video');
  if (width % 2 || height % 2) throw new Error('A video needs an even width and height');
  const config: VideoEncoderConfig = {
    // H.264 High profile; level 4.2 covers 1080p, 5.2 covers 4K.
    codec: width * height > 1920 * 1088 ? 'avc1.640034' : 'avc1.64002a',
    width,
    height,
    framerate: fps,
    // Generous: clips are short, and banding in gradients is what shows first.
    bitrate: Math.round(width * height * fps * 0.2),
    avc: { format: 'avc' },
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) {
    throw new Error(`This browser cannot encode H.264 video at ${width} × ${height}`);
  }

  // The encoders' helpers are fetched when a clip is first made, not with the page.
  const { ArrayBufferTarget, Muxer } = await import('mp4-muxer');
  const target = new ArrayBufferTarget();
  // A silent sound track, where the browser can make one: some sites and players balk at a video with none.
  const audioConfig: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 };
  const sound = typeof AudioEncoder !== 'undefined' && (await AudioEncoder.isConfigSupported(audioConfig)).supported === true;
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(sound && { audio: { codec: 'aac' as const, sampleRate: audioConfig.sampleRate, numberOfChannels: audioConfig.numberOfChannels } }),
    fastStart: 'in-memory',
  });
  let failure: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (cause) => (failure = cause),
  });
  encoder.configure(config);
  const frameMicros = 1_000_000 / fps;
  try {
    await each(async (image, i) => {
      if (failure) throw failure;
      const frame = new VideoFrame(toI420(image.pixels, width, height), {
        format: 'I420',
        codedWidth: width,
        codedHeight: height,
        timestamp: Math.round(i * frameMicros),
        duration: Math.round(frameMicros),
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
      });
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
      frame.close();
      // Let the encoder keep up rather than queue every frame's pixels.
      while (encoder.encodeQueueSize > 4) await new Promise((resolve) => setTimeout(resolve, 1));
    });
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (sound) {
    const audio = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (cause) => (failure = cause) });
    audio.configure(audioConfig);
    const total = Math.ceil((frames / fps) * audioConfig.sampleRate);
    const block = 1024;
    try {
      for (let at = 0; at < total; at += block) {
        const count = Math.min(block, total - at);
        const silence = new AudioData({
          format: 'f32',
          sampleRate: audioConfig.sampleRate,
          numberOfChannels: audioConfig.numberOfChannels,
          numberOfFrames: count,
          timestamp: Math.round((at / audioConfig.sampleRate) * 1_000_000),
          data: new Float32Array(count * audioConfig.numberOfChannels),
        });
        audio.encode(silence);
        silence.close();
      }
      await audio.flush();
      if (failure) throw failure;
    } finally {
      if (audio.state !== 'closed') audio.close();
    }
  }
  muxer.finalize();
  return new Uint8Array(target.buffer);
}

/** An 8 x 8 ordered-dither pattern, values 0..63. */
const BAYER = /* @__PURE__ */ (() => {
  const pattern = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let value = 0;
      for (let bit = 0; bit < 3; bit++) value |= ((((x ^ y) >> bit) & 1) << (5 - 2 * bit)) | (((y >> bit) & 1) << (4 - 2 * bit));
      pattern[y * 8 + x] = value;
    }
  }
  return pattern;
})();

/** How far the dither pattern pushes a channel either way: about the gap between neighbouring palette colours. */
const DITHER = 10;

/** The palette entry that means "as in the frame before". */
const UNCHANGED = 255;

async function encodeGif({ width, height, fps }: ClipOptions, each: Each): Promise<Uint8Array> {
  const { GIFEncoder, nearestColorIndex, quantize } = await import('gifenc');
  const gif = GIFEncoder();
  // One palette for the whole clip, from its first frame, and a fixed dither pattern: what
  // does not move stays the same from frame to frame instead of shimmering, and smooth
  // backdrops do not fall into bands. A frame stores only the pixels that changed since the
  // one before (the rest are marked see-through and left as they were), which is most of the saving.
  let palette: number[][] | undefined;
  const nearest = new Int16Array(32768).fill(-1);
  let previous: Uint8Array | undefined;
  await each((image, frame) => {
    const { pixels } = image;
    // Opaque over black, as in the video.
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
    if (!palette) {
      palette = quantize(pixels, UNCHANGED);
      while (palette.length <= UNCHANGED) palette.push([0, 0, 0]);
    }
    const index = new Uint8Array(width * height);
    const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (let y = 0, p = 0; y < height; y++) {
      for (let x = 0; x < width; x++, p++) {
        const push = ((BAYER[(y & 7) * 8 + (x & 7)]! + 0.5) / 64 - 0.5) * DITHER;
        const r = clamp(pixels[p * 4]! + push);
        const g = clamp(pixels[p * 4 + 1]! + push);
        const b = clamp(pixels[p * 4 + 2]! + push);
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let found = nearest[key]!;
        if (found < 0) found = nearest[key] = nearestColorIndex(palette, [r, g, b]);
        index[p] = found;
      }
    }
    const stored = previous ? index.map((value, p) => (value === previous![p] ? UNCHANGED : value)) : index;
    previous = index;
    gif.writeFrame(stored, width, height, {
      ...(frame === 0 ? { palette, repeat: 0 } : { transparent: true, transparentIndex: UNCHANGED }),
      delay: 1000 / fps,
      dispose: 1,
    });
  });
  gif.finish();
  return gif.bytes();
}
