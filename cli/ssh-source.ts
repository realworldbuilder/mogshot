import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { currentIndexFiles } from '../src/casc/local-index';
import type { ByteSource } from '../src/io/byte-source';

/**
 * Answers list and read requests for a folder, one JSON line in and one framed answer out:
 * "+<length>\n" then the bytes, or "-<length>\n" then an error message. Runs with the
 * system Python on the other computer, so nothing has to be installed there.
 */
const SERVER = `
import sys, os, json
root = sys.argv[1]
out = sys.stdout.buffer
for line in sys.stdin.buffer:
    req = json.loads(line)
    path = os.path.join(root, req['path'])
    try:
        if req['op'] == 'list':
            body = json.dumps(os.listdir(path) if os.path.isdir(path) else []).encode()
        else:
            with open(path, 'rb') as f:
                if 'offset' in req:
                    f.seek(req['offset'])
                    body = f.read(req['length'])
                else:
                    body = f.read()
        out.write(b'+%d\\n' % len(body))
    except Exception as e:
        body = str(e).encode()
        out.write(b'-%d\\n' % len(body))
    out.write(body)
    out.flush()
`;

const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;

interface Pending {
  resolve: (bytes: Buffer) => void;
  reject: (error: Error) => void;
}

/**
 * ByteSource over a game folder on another computer, read through one ssh connection
 * (key login, as `ssh <host>` works from here). Answers come back in the order asked.
 */
export class SshSource implements ByteSource {
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly pending: Pending[] = [];
  private chunks: Buffer[] = [];
  private buffered = 0;
  /** The answer being received: its length and whether it is an error. */
  private frame: { length: number; ok: boolean } | undefined;
  private stderr = '';
  private failure: Error | undefined;

  /** `host` undefined runs the same server on this computer, for the tests. */
  constructor(
    readonly host: string | undefined,
    readonly root: string,
  ) {
    const script = Buffer.from(SERVER).toString('base64');
    const command = `python3 -u -c ${quote(`import base64; exec(base64.b64decode('${script}'))`)} ${quote(root)}`;
    const [program, args] = host ? ['ssh', ['-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', host, command]] : ['/bin/sh', ['-c', command]];
    this.child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => (this.stderr += chunk.toString()));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('close', (code) => this.fail(new Error(`ssh ${host} ended (${code})${this.stderr ? `: ${this.stderr.trim()}` : ''}`)));
    this.child.stdin.on('error', () => {});
  }

  async list(dir: string): Promise<string[]> {
    return JSON.parse((await this.ask({ op: 'list', path: dir })).toString('utf8')) as string[];
  }

  async read(path: string, offset?: number, length?: number): Promise<Uint8Array> {
    const bytes = await this.ask(offset === undefined || length === undefined ? { op: 'read', path } : { op: 'read', path, offset, length });
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  close(): void {
    this.child.stdin.end();
  }

  private ask(request: object): Promise<Buffer> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      if (process.env.MOGSHOT_SSH_TRACE) console.error(Date.now(), JSON.stringify(request));
      this.child.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  private receive(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    for (;;) {
      if (!this.frame) {
        const head = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
        const newline = head.indexOf(10);
        if (newline < 0) {
          this.chunks = [head];
          return;
        }
        const header = head.subarray(0, newline).toString('ascii');
        this.frame = { length: Number(header.slice(1)), ok: header[0] === '+' };
        const rest = head.subarray(newline + 1);
        this.chunks = rest.length > 0 ? [rest] : [];
        this.buffered = rest.length;
      }
      if (this.buffered < this.frame.length) return;
      const all = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks);
      const body = all.subarray(0, this.frame.length);
      const rest = all.subarray(this.frame.length);
      this.chunks = rest.length > 0 ? [rest] : [];
      this.buffered = rest.length;
      const { ok } = this.frame;
      this.frame = undefined;
      const waiting = this.pending.shift();
      if (ok) waiting?.resolve(body);
      else waiting?.reject(new Error(`${this.host}: ${body.toString('utf8')}`));
    }
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const waiting of this.pending.splice(0)) waiting.reject(this.failure);
  }
}

/** "host:/folder" names a folder on another computer; a plain path, or a Windows drive letter, does not. */
export function remoteFolder(location: string): { host: string; root: string } | undefined {
  const match = /^([^/:\\]{2,}):(.+)$/.exec(location);
  return match ? { host: match[1]!, root: match[2]! } : undefined;
}

/**
 * Keeps what is read from a remote folder's data archives in a folder on this computer, so a
 * piece of game data crosses the network once. The archives are rewritten when the game
 * updates, and the index file names change with them, so those names are part of each key.
 */
export class CachedSource implements ByteSource {
  private stamp: Promise<string> | undefined;
  private readonly lists = new Map<string, Promise<string[]>>();

  constructor(
    private readonly inner: ByteSource,
    private readonly dir: string,
  ) {}

  list(dir: string): Promise<string[]> {
    let names = this.lists.get(dir);
    if (!names) this.lists.set(dir, (names = this.inner.list(dir)));
    return names;
  }

  async read(path: string, offset?: number, length?: number): Promise<Uint8Array> {
    if (offset === undefined || length === undefined || !/^Data\/data\/data\.\d+$/i.test(path)) return this.inner.read(path, offset, length);
    this.stamp ??= this.list('Data/data').then((names) => currentIndexFiles(names).join(','));
    const file = join(this.dir, createHash('sha1').update(`${await this.stamp}|${path}|${offset}|${length}`).digest('hex'));
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      // not read before
    }
    const bytes = await this.inner.read(path, offset, length);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(file, bytes);
    } catch {
      // the cache only speeds things up
    }
    return bytes;
  }
}
