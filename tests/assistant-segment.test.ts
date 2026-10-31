import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { matchQuery, segment } from '../host/assistant/segment.mjs';

test('segment splits Chinese into words and keeps Latin words and numbers whole', () => {
  assert.equal(segment('回复供应商合同的修改意见'), '回复 供应 商 合同 的 修改 意见');
  assert.equal(segment('升级 Node 到 24'), '升级 node 到 24');
  assert.equal(segment('采购合同纠纷处理'), '采购 合同 纠纷 处理');
});

test('segment lowercases, drops punctuation and folds full-width letters', () => {
  assert.equal(segment('Renew THE Certificate!'), 'renew the certificate');
  assert.equal(segment('合同（草稿）——v2。'), '合同 草稿 v2');
  assert.equal(segment('Ｈｅｌｌｏ　Ｗｏｒｌｄ'), 'hello world');
  assert.equal(segment('...!!! ???'), '');
  assert.equal(segment(''), '');
  assert.equal(segment(null), '');
  assert.equal(segment(undefined), '');
});

test('segment keeps ids and dates as separate searchable numbers', () => {
  assert.equal(segment('DUDU-12 server_renewal 2026-11-03'), 'dudu 12 server_renewal 2026 11 03');
});

test('matchQuery quotes every word and makes only the last one a prefix', () => {
  assert.equal(matchQuery('合同'), '"合同"*');
  assert.equal(matchQuery('renew certificate'), '"renew" "certificate"*');
  assert.equal(matchQuery('回复合同修改'), '"回复" "合同" "修改"*');
});

test('matchQuery is empty when there is nothing to search for', () => {
  assert.equal(matchQuery(''), '');
  assert.equal(matchQuery('  \t'), '');
  assert.equal(matchQuery('"""'), '');
  assert.equal(matchQuery('()*-:'), '');
  assert.equal(matchQuery(null), '');
});

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

test('matchQuery finds Chinese words, Latin prefixes and words with punctuation inside', () => {
  const { find, db } = indexed(['回复供应商合同的修改意见', 'Renew the server certificate', '整理发票', 'server_renewal 2026-11-03', '劳务合同审核']);
  assert.deepEqual(find('合同'), [1, 5]);
  assert.deepEqual(find('cert'), [2]);
  assert.deepEqual(find('RENEW server'), [2]);
  assert.deepEqual(find('server_renewal'), [4]);
  assert.deepEqual(find('2026-11'), [4]);
  assert.deepEqual(find('发票'), [3]);
  assert.deepEqual(find('没有这个词'), []);
  db.close();
});

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
