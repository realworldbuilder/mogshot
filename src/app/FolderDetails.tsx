import type { ComponentChildren } from 'preact';
import type { OpenResult } from '../worker/api';

interface Props {
  opened: OpenResult;
  dragging: boolean;
  /** The control for choosing a different folder. */
  chooser: ComponentChildren;
  onProduct: (product: string) => void;
}

/** What Mogshot found in the folder: product, build, and how much of it is on disk. */
export function FolderDetails({ opened, dragging, chooser, onProduct }: Props) {
  const { info, stats, products } = opened;
  const percent = ((stats.onDisk / stats.listed) * 100).toFixed(2);
  const highRes =
    stats.highResListed === 0
      ? 'This build has no separate high-res textures.'
      : stats.highResOnDisk / stats.highResListed > 0.9
        ? `Installed (${stats.highResOnDisk.toLocaleString()} of ${stats.highResListed.toLocaleString()}).`
        : `Not installed (${stats.highResOnDisk.toLocaleString()} of ${stats.highResListed.toLocaleString()} on disk). Standard textures are used.`;

  return (
    <section class={`panel ${dragging ? 'over' : ''}`} id="folder-details">
      <h2>Your game folder</h2>
      <dl>
        <dt>Product</dt>
        <dd>
          {products.length > 1 ? (
            <select id="product" value={info.product} onChange={(event) => onProduct(event.currentTarget.value)}>
              {products.map((p) => (
                <option value={p.product}>
                  {p.product} {p.version}
                </option>
              ))}
            </select>
          ) : (
            <code>{info.product}</code>
          )}
        </dd>
        <dt>Build</dt>
        <dd id="build">
          {info.version}{' '}
          <span class="dim">
            ({info.buildName}, {info.locale})
          </span>
        </dd>
        <dt>Files on disk</dt>
        <dd id="files">
          {stats.onDisk.toLocaleString()} of {stats.listed.toLocaleString()} ({percent}%)
        </dd>
        <dt>High-res textures</dt>
        <dd id="highres">{highRes}</dd>
        <dt>Indexed in</dt>
        <dd id="indexed">{(opened.ms / 1000).toFixed(1)} s</dd>
      </dl>
      <p class="small" style="margin-top:14px">{chooser} <span class="dim">or drag another folder onto the page.</span></p>
    </section>
  );
}
