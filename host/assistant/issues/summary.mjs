/** Keep the first factual sentence; semicolons separate the old multi-update summaries. */
export function progressSentence(value) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (!text) return '';
  const first = text.split(/(?<=[。！？])|(?<=[.!?])\s+|[;；]\s*/u)[0].trim();
  return first && !/[。.!?！？]$/u.test(first) && /[;；]/u.test(text) ? `${first}${/[\p{Script=Han}]/u.test(first) ? '。' : '.'}` : first;
}
