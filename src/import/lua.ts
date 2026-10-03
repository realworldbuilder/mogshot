/*
 * A reader for the Lua that the game writes to SavedVariables: one or more top-level
 * assignments of table literals. It understands exactly the subset the game emits (nested
 * tables, string and integer keys, positional values with `nil` holes, numbers, booleans,
 * strings with byte escapes, `--` comments) and nothing else. Nothing is executed.
 */

export type LuaValue = string | number | boolean | LuaTable;
export type LuaTable = Map<string | number, LuaValue>;

class Reader {
  private pos = 0;
  private line = 1;
  private readonly bytes = new TextDecoder();

  constructor(private readonly text: string) {}

  private fail(what: string): never {
    throw new Error(`Line ${this.line}: ${what}`);
  }

  private peek(): string {
    return this.text[this.pos] ?? '';
  }

  private take(): string {
    const ch = this.text[this.pos++] ?? '';
    if (ch === '\n') this.line++;
    return ch;
  }

  /** Skip whitespace and `--` comments. */
  skip(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') this.take();
      else if (ch === '-' && this.text[this.pos + 1] === '-') {
        while (this.pos < this.text.length && this.peek() !== '\n') this.take();
      } else return;
    }
  }

  expect(ch: string): void {
    this.skip();
    if (this.peek() !== ch) this.fail(`expected "${ch}"${this.pos < this.text.length ? ` but found "${this.peek()}"` : ' but the file ended'}`);
    this.take();
  }

  atEnd(): boolean {
    this.skip();
    return this.pos >= this.text.length;
  }

  identifier(): string {
    this.skip();
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.pos, this.pos + 200));
    if (!match) this.fail('expected a name');
    this.pos += match[0].length;
    return match[0];
  }

  string(): string {
    this.expect('"');
    const out: number[] = [];
    for (;;) {
      if (this.pos >= this.text.length) this.fail('unterminated string');
      const ch = this.take();
      if (ch === '"') break;
      if (ch !== '\\') {
        // Characters the game did not escape are plain ASCII; keep their code points as bytes.
        const code = ch.codePointAt(0)!;
        if (code < 0x80) out.push(code);
        else out.push(...new TextEncoder().encode(ch));
        continue;
      }
      const next = this.take();
      if (/[0-9]/.test(next)) {
        let digits = next;
        while (digits.length < 3 && /[0-9]/.test(this.peek())) digits += this.take();
        out.push(Number(digits) & 0xff);
      } else {
        const simple: Record<string, number> = { n: 10, r: 13, t: 9, '"': 34, '\\': 92, "'": 39, '\n': 10 };
        const byte = simple[next];
        if (byte === undefined) this.fail(`unknown escape \\${next}`);
        out.push(byte);
      }
    }
    return this.bytes.decode(new Uint8Array(out));
  }

  value(): LuaValue {
    this.skip();
    const ch = this.peek();
    if (ch === '{') return this.table();
    if (ch === '"') return this.string();
    const rest = this.text.slice(this.pos, this.pos + 64);
    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      this.pos += number[0].length;
      return Number(number[0]);
    }
    const word = /^[a-z]+/.exec(rest)?.[0];
    if (word === 'true' || word === 'false') {
      this.pos += word.length;
      return word === 'true';
    }
    this.fail(`unexpected ${ch === '' ? 'end of file' : `"${ch}"`}`);
  }

  table(): LuaTable {
    this.expect('{');
    const table: LuaTable = new Map();
    let next = 1;
    for (;;) {
      this.skip();
      const ch = this.peek();
      if (ch === '}') {
        this.take();
        return table;
      }
      if (ch === '') this.fail('the table is not closed');
      let key: string | number | undefined;
      if (ch === '[') {
        this.take();
        this.skip();
        key = this.peek() === '"' ? this.string() : (this.value() as number);
        if (typeof key !== 'string' && typeof key !== 'number') this.fail('a key must be a string or a number');
        this.expect(']');
        this.expect('=');
      } else if (/[A-Za-z_]/.test(ch)) {
        const save = { pos: this.pos, line: this.line };
        const name = this.identifier();
        this.skip();
        if (this.peek() === '=') {
          this.take();
          key = name;
        } else {
          // A bare word that is a value (true, false, nil), not a key.
          this.pos = save.pos;
          this.line = save.line;
        }
      }
      if (key === undefined) {
        // A positional value. `nil` takes a position and stores nothing.
        if (this.text.startsWith('nil', this.pos)) this.pos += 3;
        else table.set(next, this.value());
        next++;
      } else {
        if (this.text.startsWith('nil', this.pos) && !/[A-Za-z0-9_]/.test(this.text[this.pos + 3] ?? '')) this.pos += 3;
        else table.set(key, this.value());
      }
      this.skip();
      if (this.peek() === ',' || this.peek() === ';') this.take();
      else if (this.peek() !== '}') this.fail('expected "," or "}"');
    }
  }
}

/** Every `Name = value` assignment in a SavedVariables file, by name. */
export function readSavedVariables(text: string): Map<string, LuaValue> {
  const reader = new Reader(text);
  const result = new Map<string, LuaValue>();
  while (!reader.atEnd()) {
    const name = reader.identifier();
    reader.expect('=');
    result.set(name, reader.value());
  }
  return result;
}

/** A nested value by path, or undefined. */
export function at(value: LuaValue | undefined, ...path: (string | number)[]): LuaValue | undefined {
  let current = value;
  for (const key of path) {
    if (!(current instanceof Map)) return undefined;
    current = current.get(key);
  }
  return current;
}
