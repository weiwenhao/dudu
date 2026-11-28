import assert from 'node:assert/strict';
import test from 'node:test';
import { imagesAsBlocks, markdownImagePath } from '../host/native-markdown-images.mjs';

function message(text: string) {
  return { type: 'assistant/message', surfaceOp: 'append', data: { message: { content: [{ type: 'text', text }] } } };
}

test('Markdown images resolve only image destinations, including references, escaped parentheses and encoded paths', () => {
  const event = message([
    '![before](/workspace/.local/before.png)',
    '![after](<pictures/设置 after (2).png>)',
    '![reference][details]',
    '![escaped](pictures/a\\(b\\).png)',
    '[details]: file:///workspace/reference%20image.png',
    '[download](/workspace/report.png)',
    '`![code](/private/inline.png)`',
    '```md\n![example](/private/code.png)\n```',
  ].join('\n\n'));
  assert.equal(markdownImagePath(event, '/workspace/.local/before.png'), '/workspace/.local/before.png');
  assert.equal(markdownImagePath(event, 'pictures/%E8%AE%BE%E7%BD%AE%20after%20(2).png', '/workspace'), '/workspace/pictures/设置 after (2).png');
  const mixed = message('![image](/workspace/设置%20after.png)');
  assert.equal(markdownImagePath(mixed, '/workspace/%E8%AE%BE%E7%BD%AE%2520after.png'), '/workspace/设置 after.png');
  assert.equal(markdownImagePath(event, 'file:///workspace/reference%20image.png'), '/workspace/reference image.png');
  assert.equal(markdownImagePath(event, 'pictures/a(b).png', '/workspace'), '/workspace/pictures/a(b).png');
  for (const source of ['/etc/passwd', '/workspace/report.png', '/private/inline.png', '/private/code.png']) {
    assert.throws(() => markdownImagePath(event, source, '/workspace'), { code: 'NOT_FOUND' });
  }
});

test('Markdown image selectors reject other events, remote transports, missing working directories and null bytes', () => {
  for (const source of [
    'https://example.com/image.png', '//example.com/image.png', 'file://example.com/image.png',
    'data:image/png;base64,AAAA', '/workspace/picture%00.png',
  ]) {
    assert.throws(() => markdownImagePath(message(`![image](${source})`), source, '/workspace'), { code: 'NOT_FOUND' });
  }
  const event = message('![image](relative.png)');
  assert.throws(() => markdownImagePath(event, 'relative.png'), { code: 'NOT_FOUND' });
  for (const altered of [
    { ...event, type: 'tool/result' }, { ...event, type: 'user/message' },
    { ...event, surfaceOp: 'replace' },
  ]) {
    assert.throws(() => markdownImagePath(altered, 'relative.png', '/workspace'), { code: 'NOT_FOUND' });
  }
  assert.throws(() => markdownImagePath(event, 'relative.png'.repeat(1000), '/workspace'), { code: 'NOT_FOUND' });
  const duplicateDefinition = message('![image][one]\n\n[one]: /workspace/first.png\n\n[one]: /workspace/last.png');
  assert.equal(markdownImagePath(duplicateDefinition, '/workspace/first.png'), '/workspace/first.png');
  assert.throws(() => markdownImagePath(duplicateDefinition, '/workspace/last.png'), { code: 'NOT_FOUND' });
});

test('A line of 嘟嘟\'s group chat grants its images as a message does: an answer or a task\'s result, only through the command that carries it', () => {
  const run = (name: string, commandId: string) => ({ type: 'command/run', data: { name, commandId } });
  const lines: Record<string, { kind: string; text?: string }> = {
    answer: { kind: 'reply', text: 'Done.\n\n![shot](/workspace/shot.png)' },
    task: { kind: 'task', text: 'Result ![chart](/workspace/chart.png)' },
    mine: { kind: 'at', text: '![mine](/workspace/mine.png)' },
  };
  const lookup = (id: string) => lines[id] ?? null;
  assert.equal(markdownImagePath(run('dudu-say', 'answer'), '/workspace/shot.png', undefined, lookup), '/workspace/shot.png');
  assert.equal(markdownImagePath(run('dudu-say', 'task'), '/workspace/chart.png', undefined, lookup), '/workspace/chart.png');
  // the owner's own line, another command, a command the plugin does not know, a file the line does not show, and no lookup at all grant nothing
  assert.throws(() => markdownImagePath(run('dudu-say', 'mine'), '/workspace/mine.png', undefined, lookup), { code: 'NOT_FOUND' });
  assert.throws(() => markdownImagePath(run('dudu-card', 'answer'), '/workspace/shot.png', undefined, lookup), { code: 'NOT_FOUND' });
  assert.throws(() => markdownImagePath(run('dudu-say', 'gone'), '/workspace/shot.png', undefined, lookup), { code: 'NOT_FOUND' });
  assert.throws(() => markdownImagePath(run('dudu-say', 'answer'), '/etc/passwd', undefined, lookup), { code: 'NOT_FOUND' });
  assert.throws(() => markdownImagePath(run('dudu-say', 'answer'), '/workspace/shot.png'), { code: 'NOT_FOUND' });
  // a relative path has no working directory in a group line (it would be the assistant's, not the issue's)
  lines.relative = { kind: 'reply', text: '![r](pictures/r.png)' };
  assert.throws(() => markdownImagePath(run('dudu-say', 'relative'), 'pictures/r.png', undefined, lookup), { code: 'NOT_FOUND' });
});

// 2026-11-27: an image under a line of text with no blank line between is a part of that paragraph, which the phone draws inline, without a tap to open it.
test('an image that has its line under a line of text gets blank lines around it, and nothing else is touched', () => {
  assert.equal(imagesAsBlocks('First:\n![a](x.png)\n\nMore'), 'First:\n\n![a](x.png)\n\nMore');
  assert.equal(imagesAsBlocks('Text\n![a](x.png)\n![b](y.png)\nText'), 'Text\n\n![a](x.png)\n\n![b](y.png)\n\nText');
  assert.equal(imagesAsBlocks('Text\r\n![a](x.png)\r\nText'), 'Text\r\n\n![a](x.png)\r\n\nText');
  assert.equal(imagesAsBlocks('Text\n![a][ref]\nText\n\n[ref]: y.png'), 'Text\n\n![a][ref]\n\nText\n\n[ref]: y.png');
  const left = [
    'An image alone\n\n![a](x.png)\n\nbetween blank lines', 'a sentence with ![a](x.png) inside\nand more', '- item\n  ![a](x.png)\n- item', '> quoted\n> ![a](x.png)',
    '```md\ntext\n![a](x.png)\n```', 'no image at all', '', '![a](x.png)', 'Text\n\n![a](x.png)', '![a](x.png)\nText',
  ];
  for (const text of left.slice(0, -1)) assert.equal(imagesAsBlocks(text), text, text);
  assert.equal(imagesAsBlocks('![a](x.png)\nText'), '![a](x.png)\n\nText', 'the text under an image on the first line');
  assert.equal(imagesAsBlocks(undefined as any), undefined);
});
