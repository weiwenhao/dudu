import assert from 'node:assert/strict';
import test from 'node:test';
import { queryTerms, splitByTerms } from '../host/dudu-plugin/ui/sessions/highlight.js';

const pieces = (text: string, query: string) => splitByTerms(text, queryTerms(query)).map((piece: { text: string; hit: boolean }) => (piece.hit ? `[${piece.text}]` : piece.text)).join('');

test('a search is the words between spaces, in lower case', () => {
  assert.deepEqual(queryTerms('  CI   超时 '), ['ci', '超时']);
  assert.deepEqual(queryTerms(''), []);
  assert.deepEqual(queryTerms(undefined), []);
});

test('text is cut where the words are found, whatever their case, and keeps what was written', () => {
  assert.equal(pieces('CI 又超时了，帮我看看', '超时'), 'CI 又[超时]了，帮我看看');
  assert.equal(pieces('Fix the CI timeout in ci.yml', 'ci'), 'Fix the [CI] timeout in [ci].yml');
  assert.equal(pieces('超时和超时', '超时'), '[超时]和[超时]');
  assert.equal(pieces('a timeout and a CI run', 'run timeout'), 'a [timeout] and a CI [run]');
});

test('the longest word wins where words overlap, and the characters of a pattern are only characters', () => {
  assert.equal(pieces('超时的日志', '超时 超时的'), '[超时的]日志');
  assert.equal(pieces('cost (1+1)*2 [x] $5?', '(1+1)*2 [x] $5?'), 'cost [(1+1)*2] [[x]] [$5?]');
  assert.equal(pieces('a.b and axb', 'a.b'), '[a.b] and axb', 'a dot is not "any character"');
  assert.equal(pieces('x (y) z', '(y)'), 'x [(y)] z');
});

test('with nothing to find, or nothing to search, the text stays whole', () => {
  assert.deepEqual(splitByTerms('abc', []), [{ text: 'abc', hit: false }]);
  assert.deepEqual(splitByTerms('', ['a']), [{ text: '', hit: false }]);
  assert.deepEqual(splitByTerms(undefined, ['a']), [{ text: '', hit: false }]);
  assert.equal(pieces('abc', 'zzz'), 'abc');
});
