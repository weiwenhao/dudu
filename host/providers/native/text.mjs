/** One line of text, cut at `limit` characters. */
export function oneLine(text, limit = 160) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  const characters = [...line];
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : line;
}

/** A string kept to `limit` characters, marked when it was cut. */
export function clip(text, limit) {
  const value = typeof text === 'string' ? text : '';
  return value.length > limit ? `${value.slice(0, limit)}\n… (output truncated)` : value;
}
