import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { matchQuery, segment } from '../host/assistant/segment.mjs';

function indexed(titles: string[]) {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE VIRTUAL TABLE docs USING fts5(title, tokenize = 'unicode61 remove_diacritics 2')");
  const insert = db.prepare('INSERT INTO docs (rowid, title) VALUES (?, ?)');
  titles.forEach((title, index) => insert.run(index + 1, segment(title)));
  // An empty query is not valid FTS5, so callers (the issues store) check for '' before searching.
  const find = (text: string) => {
    const query = matchQuery(text);
    return query ? (db.prepare('SELECT rowid FROM docs WHERE docs MATCH ? ORDER BY rowid').all(query) as any[]).map((row) => row.rowid) : [];
  };
  return { find, db };
}

test('matchQuery never lets user text become FTS5 syntax', () => {
  const { find, db } = indexed(['a', 'b', 'a or b', 'near the title', 'plain words']);
  // Operators are just words: this is "a" AND "or" AND prefix "b", so only the row holding all three matches.
  assert.deepEqual(find('a" OR b*'), [3]);
  assert.deepEqual(find('NEAR(near title)'), [4]);
  for (const hostile of ['title:foo', '-bar', '"', '"unterminated', ')(', '*', '^start', 'a AND', 'OR', 'a NOT b', '{x y}', "'; DROP TABLE docs; --", 'x'.repeat(10_000)]) {
    assert.doesNotThrow(() => find(hostile), hostile.slice(0, 30));
  }
  db.close();
});
