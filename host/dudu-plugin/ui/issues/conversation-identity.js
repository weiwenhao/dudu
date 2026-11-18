/** B-1's title extract, shared by every generated issue avatar. Never use the issue ID. */
export function conversationInitials(value) {
  const title = String(value ?? '').trim();
  const latin = /^[A-Za-z0-9]+/u.exec(title)?.[0];
  if (latin) return (latin.length <= 3 ? latin : latin.slice(0, 2)).toUpperCase();
  return /^[\p{Script=Han}]{1,2}/u.exec(title)?.[0] ?? [...title].slice(0, 2).join('');
}

/** How many tones a letter avatar has (styles.css `--tone-0` to `--tone-11`; the phone and Android have the same twelve). It was seven until 2026-11-18, when one screen of the owner's phone had five roses ("加到 12 种吧"). */
export const AVATAR_TONES = 12;

/** Same twelve title-based tones as ConnectorAvatar and the native Apps. */
export function conversationTone(value) {
  let sum = 0;
  for (const char of String(value ?? '')) sum = (sum * 31 + char.codePointAt(0)) >>> 0;
  return sum % AVATAR_TONES;
}
