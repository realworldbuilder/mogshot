/** The pictures that can be saved. A fixed-size picture shows what the preview shows; a tight crop fits the character. */
export const SIZES = [
  { id: 'tight', name: 'Tight crop (4K tall or wide)', width: 2880, height: 3840, tight: true },
  { id: '4k', name: '4K (3840 × 2160)', width: 3840, height: 2160, tight: false },
  { id: '1080p', name: '1080p (1920 × 1080)', width: 1920, height: 1080, tight: false },
  { id: 'youtube', name: 'YouTube thumbnail (1280 × 720)', width: 1280, height: 720, tight: false },
  { id: 'square', name: 'Square (2160 × 2160)', width: 2160, height: 2160, tight: false },
  { id: 'reel', name: 'Reel or Story (2160 × 3840; clips 1080 × 1920)', width: 2160, height: 3840, tight: false },
] as const;
export type Size = (typeof SIZES)[number];

/** Pixel size of the preview for a picture shape: about a million pixels, sharp on a high-density screen. */
export function previewSize(size: { width: number; height: number }): { width: number; height: number } {
  const aspect = size.width / size.height;
  const height = Math.round(Math.sqrt(1_100_000 / aspect) / 2) * 2;
  return { width: Math.round((height * aspect) / 2) * 2, height };
}

/** Save PNG bytes as a file. */
export function downloadPng(png: Uint8Array, name: string): void {
  downloadFile(png, name, 'image/png');
}

export function downloadFile(bytes: Uint8Array, name: string, type: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** "Saved 3,840 × 2,160 pixels (1.2 MB) in 0.4 s." */
export function savedNote(what: string, image: { width: number; height: number }, png: Uint8Array, start: number): string {
  return (
    `${what} ${image.width.toLocaleString()} × ${image.height.toLocaleString()} pixels ` +
    `(${(png.length / 1024 / 1024).toFixed(1)} MB) in ${((performance.now() - start) / 1000).toFixed(1)} s.`
  );
}
