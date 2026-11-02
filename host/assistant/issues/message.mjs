/** Mentions route one explicit request. Addresses, inline code and fenced examples remain ordinary comments. */
export function issueMessage(text, assignedAgent) {
  if (typeof text !== 'string' || !text.trim() || text.length > 20_000) return { error: 'invalid_message' };
  const visible = text.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, (part) => ' '.repeat(part.length));
  const mentions = [...visible.matchAll(/(^|[\s(（])@(dudu|嘟嘟|claude|codex|chatgpt|deepseek|agent)(?=$|[\s,，:：.!?。！？)）])/giu)];
  const targets = new Set(mentions.map((match) => {
    const name = match[2].toLowerCase();
    return name === '嘟嘟' ? 'dudu' : name === 'chatgpt' ? 'codex' : name === 'agent' ? assignedAgent ?? 'agent' : name;
  }));
  if (targets.size > 1) return { error: 'multiple_targets' };
  const target = [...targets][0] ?? null;
  if (target === 'agent') return { error: 'choose_agent' };
  if (target && target !== 'dudu' && target !== assignedAgent) return { error: 'recipient_unavailable' };
  let body = text;
  for (const match of mentions.reverse()) {
    const start = match.index + match[1].length;
    body = body.slice(0, start) + body.slice(start + match[2].length + 1);
  }
  body = body.trim().replace(/^[,，:：]\s*/, '');
  if (target && !body) return { error: 'empty_request' };
  return { target, text: text.trim(), body };
}
