import { useEffect, useRef } from 'preact/hooks';
import type { Image } from '../formats/blp';

/** A picture read from the game files, shown on a canvas of its own size; blank until there is one. */
export function Pixels({ image, class: className }: { image: Image | undefined; class?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext('2d')!;
    context.clearRect(0, 0, target.width, target.height);
    if (!image) return;
    target.width = image.width;
    target.height = image.height;
    context.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  }, [image]);
  return <canvas class={className} ref={canvas} width={64} height={64} />;
}
