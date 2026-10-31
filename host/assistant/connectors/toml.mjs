// A small, tolerant TOML reader for the one file the connectors library has to read that is TOML: Codex's config.toml,
// whose [mcp_servers.*] tables list the MCP servers Codex launches (docs/assistant.md 3.1, discovery). Node has no TOML
// parser built in and the plugin may not add a dependency, so this covers the TOML that file is made of: tables and
// arrays of tables, dotted and quoted keys, basic / literal / multi-line strings with their escapes, numbers, booleans,
// dates (kept as text), arrays and inline tables.
//
// It never throws. A statement it cannot read is skipped up to the end of its line, and the keys that follow a broken
// table header are dropped instead of landing in the table before it. Tables are objects without a prototype.
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const BARE_KEY = /[A-Za-z0-9_-]/;
const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };

class TomlError extends Error {}

export function parseToml(source) {
  const s = String(source ?? '').replace(/^\uFEFF/, '');
  const n = s.length;
  const root = Object.create(null);
  let table = root;
  let i = 0;

  const fail = (message = 'invalid TOML') => { throw new TomlError(message); };
  const skipSpace = () => { while (i < n && (s[i] === ' ' || s[i] === '\t')) i++; };
  const skipBlank = () => {
    for (;;) {
      skipSpace();
      if (s[i] === '#') while (i < n && s[i] !== '\n') i++;
      else if (s[i] === '\n' || s[i] === '\r') i++;
      else return;
    }
  };
  const expect = (char) => { if (s[i] !== char) fail(`expected ${char}`); i++; };

  function readEscape() {
    const code = s[i++];
    if (code in ESCAPES) return ESCAPES[code];
    const width = { x: 2, u: 4, U: 8 }[code];
    if (!width) fail('bad escape');
    const hex = s.slice(i, i + width);
    if (!new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) fail('bad escape');
    i += width;
    try {
      return String.fromCodePoint(parseInt(hex, 16));
    } catch {
      return fail('bad escape');
    }
  }

  function readBasic() {
    expect('"');
    let out = '';
    for (;;) {
      if (i >= n || s[i] === '\n') fail('unterminated string');
      if (s[i] === '"') { i++; return out; }
      if (s[i] === '\\') { i++; out += readEscape(); } else out += s[i++];
    }
  }

  function readLiteral() {
    expect("'");
    const end = s.indexOf("'", i);
    if (end < 0 || s.slice(i, end).includes('\n')) fail('unterminated string');
    const out = s.slice(i, end);
    i = end + 1;
    return out;
  }

  function readMultiline(quote) {
    const fence = quote.repeat(3);
    i += 3;
    if (s[i] === '\r' && s[i + 1] === '\n') i += 2;
    else if (s[i] === '\n') i++;
    let out = '';
    for (;;) {
      if (i >= n) fail('unterminated string');
      if (s.startsWith(fence, i)) {
        let extra = 0; // a run of up to five quotes ends the string, the first ones belong to it
        while (extra < 2 && s[i + 3 + extra] === quote) extra++;
        out += quote.repeat(extra);
        i += 3 + extra;
        return out;
      }
      if (quote === '"' && s[i] === '\\') {
        i++;
        if (s[i] === '\n' || s[i] === '\r' || s[i] === ' ' || s[i] === '\t') { while (i < n && /[ \t\r\n]/.test(s[i])) i++; } else out += readEscape();
      } else out += s[i++];
    }
  }

  function readKey() {
    skipSpace();
    if (s[i] === '"') return readBasic();
    if (s[i] === "'") return readLiteral();
    const start = i;
    while (i < n && BARE_KEY.test(s[i])) i++;
    if (i === start) fail('expected a key');
    return s.slice(start, i);
  }

  function readKeyPath() {
    const path = [readKey()];
    for (;;) {
      skipSpace();
      if (s[i] !== '.') return path;
      i++;
      path.push(readKey());
    }
  }

  function readArray() {
    expect('[');
    const out = [];
    for (;;) {
      skipBlank();
      if (s[i] === ']') { i++; return out; }
      out.push(readValue());
      skipBlank();
      if (s[i] === ',') i++;
      else if (s[i] !== ']') fail('expected , or ]');
    }
  }

  function readInline() {
    expect('{');
    const out = Object.create(null);
    for (;;) {
      skipBlank();
      if (s[i] === '}') { i++; return out; }
      assign(out, readKeyPath(), (skipSpace(), expect('='), readValue()));
      skipBlank();
      if (s[i] === ',') i++;
      else if (s[i] !== '}') fail('expected , or }');
    }
  }

  function readValue() {
    skipSpace();
    const c = s[i];
    if (c === '"') return s.startsWith('"""', i) ? readMultiline('"') : readBasic();
    if (c === "'") return s.startsWith("'''", i) ? readMultiline("'") : readLiteral();
    if (c === '[') return readArray();
    if (c === '{') return readInline();
    const start = i;
    while (i < n && !/[\s,\]}#]/.test(s[i])) i++;
    const word = s.slice(start, i);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (/^[+-]?(?:\d[\d_]*|0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+)$/.test(word)) return Number(word.replaceAll('_', '').replace(/^\+/, ''));
    if (/^[+-]?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?$/.test(word)) return Number(word.replaceAll('_', ''));
    if (/^[+-]?(?:inf|nan)$/.test(word)) return Number(word.replace(/^\+/, '').replace('inf', 'Infinity').replace('nan', 'NaN'));
    if (/^\d{4}-\d\d-\d\d|^\d\d:\d\d:\d\d/.test(word)) return word;
    return fail('bad value');
  }

  // Walks (and creates) the tables on a path; the last table of an array of tables is the one that is current.
  function descend(from, path) {
    let current = from;
    for (const key of path) {
      if (FORBIDDEN.has(key)) fail('forbidden key');
      let next = current[key];
      if (next === undefined) next = current[key] = Object.create(null);
      if (Array.isArray(next)) next = next[next.length - 1] ?? fail('empty array of tables');
      if (typeof next !== 'object' || next === null) fail('key is not a table');
      current = next;
    }
    return current;
  }

  function assign(into, path, value) {
    const last = path[path.length - 1];
    if (FORBIDDEN.has(last)) fail('forbidden key');
    descend(into, path.slice(0, -1))[last] = value;
  }

  function readHeader() {
    const array = s[i + 1] === '[';
    i += array ? 2 : 1;
    const path = readKeyPath();
    skipSpace();
    expect(']');
    if (array) expect(']');
    if (!array) return descend(root, path);
    const parent = descend(root, path.slice(0, -1));
    const key = path[path.length - 1];
    if (FORBIDDEN.has(key)) fail('forbidden key');
    if (parent[key] === undefined) parent[key] = [];
    if (!Array.isArray(parent[key])) fail('key is not an array of tables');
    const created = Object.create(null);
    parent[key].push(created);
    return created;
  }

  while (i < n) {
    skipBlank();
    if (i >= n) break;
    const start = i;
    const header = s[i] === '[';
    try {
      if (header) table = readHeader();
      else assign(table, readKeyPath(), (skipSpace(), expect('='), readValue()));
      skipSpace();
      if (s[i] === '#') while (i < n && s[i] !== '\n') i++;
      else if (i < n && s[i] !== '\n' && s[i] !== '\r') fail('unexpected text after a value');
    } catch {
      // Any failure, even running out of stack on absurdly nested arrays, only costs the statement it happened in.
      if (header) table = Object.create(null);
      i = Math.max(i, start);
      while (i < n && s[i] !== '\n') i++;
    }
  }
  return root;
}
