import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayAddress, isLoopback, isSameOrigin, parseAppConnection, parseConnection } from '../src/connection.ts';

test('accepts a complete pairing URL without exposing its credentials in the display label', () => {
  const value = parseConnection(' http://192.168.1.4:3097/?pair=private ', '书房 Mac');
  assert.equal(value.name, '书房 Mac');
  assert.equal(value.url, 'http://192.168.1.4:3097/?pair=private');
  assert.equal(displayAddress(value.url), '192.168.1.4:3097');
});

test('reads desktop identity and computer name from its pairing QR while allowing a custom label', () => {
  const url = 'https://desktop.example.com/?pair=private&computer=desktop-123&name=%E4%B9%A6%E6%88%BF%20Mac';
  const value = parseConnection(url);
  assert.equal(value.name, '书房 Mac');
  assert.equal(value.computerId, 'desktop-123');
  assert.equal(parseConnection(url, '我的电脑').name, '我的电脑');
  assert.equal(parseConnection('https://old.example.com/?pair=private').name, 'old.example.com');
  assert.throws(() => parseConnection(url + '&computer=other'));
  assert.throws(() => parseConnection('https://desktop.example.com/?pair=private&computer=a%2Fb'));
});

test('rejects executable, ambiguous and embedded-credential addresses', () => {
  for (const value of ['', '192.168.1.4:3097', 'javascript:alert(1)',
    'file:///etc/passwd', 'https://user:password@example.com', 'https://example.com/#secret']) {
    assert.throws(() => parseConnection(value), undefined, value);
  }
});

test('navigation uses exact origins and identifies phone-local addresses', () => {
  assert.ok(isSameOrigin('https://example.com/api', 'https://example.com/?token=a'));
  assert.ok(!isSameOrigin('https://example.com.evil.test', 'https://example.com'));
  assert.ok(!isSameOrigin('http://example.com', 'https://example.com'));
  assert.ok(!isSameOrigin('https://example.com:8443', 'https://example.com'));
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.ok(isLoopback(`http://${host}:3097`));
  assert.ok(!isLoopback('http://192.168.1.4:3097'));
});

test('app links produce a draft only for the registered connect route and validate its target', () => {
  const url = 'http://192.168.1.4:3097/?pair=private';
  const draft = parseAppConnection(`harness-mobile://connect?url=${encodeURIComponent(url)}`);
  assert.equal(draft?.url, url);
  assert.equal(parseAppConnection(null), null);
  assert.equal(parseAppConnection('harness-mobile://other?url=' + encodeURIComponent(url)), null);
  assert.equal(parseAppConnection('https://example.com?url=' + encodeURIComponent(url)), null);
  assert.throws(() => parseAppConnection('harness-mobile://connect?url=javascript:alert(1)'));
  assert.throws(() => parseAppConnection(`harness-mobile://connect?url=${encodeURIComponent(url)}&url=${encodeURIComponent(url)}`));
});
