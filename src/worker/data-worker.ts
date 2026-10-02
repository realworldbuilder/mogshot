/// <reference lib="webworker" />
import { CascStorage, InstallError, listProducts } from '../casc/storage';
import type { ByteSource } from '../io/byte-source';
import { FileListSource } from '../io/file-list-source';
import { HandleSource } from '../io/handle-source';
import type { OpenResult, ProbeResult, Request, Response } from './api';

let storage: CascStorage | undefined;

const post = (message: Response, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);

async function handle(request: Request): Promise<{ value: unknown; transfer?: Transferable[] }> {
  switch (request.method) {
    case 'open': {
      const source: ByteSource =
        request.source.kind === 'handle'
          ? new HandleSource(request.source.handle)
          : new FileListSource(request.source.files);
      const start = performance.now();
      const products = await listProducts(source);
      storage = await CascStorage.open(source, {
        product: request.product,
        onProgress: (stage) => post({ id: request.id, type: 'progress', stage }),
      });
      const value: OpenResult = {
        info: storage.info,
        stats: storage.files.stats,
        products,
        ms: performance.now() - start,
      };
      return { value };
    }
    case 'probe': {
      if (!storage) throw new Error('No folder is open');
      const start = performance.now();
      const entry = storage.files.find(request.fileId);
      const file = await storage.readFile(request.fileId);
      const head = file ? file.data.slice(0, 256) : new Uint8Array(0);
      const value: ProbeResult = {
        status: file ? 'ok' : storage.files.isMissing(request.fileId) ? 'missing' : 'unknown',
        size: file?.data.length ?? 0,
        head,
        encryptedChunks: file?.encrypted.length ?? 0,
        highRes: entry?.highRes ?? false,
        highResMissing: entry?.highResMissing ?? false,
        ms: performance.now() - start,
      };
      return { value, transfer: [head.buffer] };
    }
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    const { value, transfer } = await handle(request);
    post({ id: request.id, type: 'result', value }, transfer);
  } catch (error) {
    post({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      install: error instanceof InstallError,
    });
  }
};
