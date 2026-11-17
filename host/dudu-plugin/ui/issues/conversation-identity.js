/** B-1's title extract, shared by every generated issue avatar. Never use the issue ID. */
export function conversationInitials(value) {
  const title = String(value ?? '').trim();
  const latin = /^[A-Za-z0-9]+/u.exec(title)?.[0];
  if (latin) return (latin.length <= 3 ? latin : latin.slice(0, 2)).toUpperCase();
  return /^[\p{Script=Han}]{1,2}/u.exec(title)?.[0] ?? [...title].slice(0, 2).join('');
}

/** Same seven title-based tones as ConnectorAvatar and the native App. */
export function conversationTone(value) {
  let sum = 0;
  for (const char of String(value ?? '')) sum = (sum * 31 + char.codePointAt(0)) >>> 0;
  return sum % 7;
}
