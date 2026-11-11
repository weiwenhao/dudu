/** DSH's /skills are ordinary editable text. Only a leading @issue is a routing address. */
export function completionAt(text, start, end = start) {
  if (start !== end) return null;
  const before = text.slice(0, start);
  const issue = /^\s*@([^\s@]*)$/u.exec(before);
  if (issue) return { kind: 'issue', query: issue[1], start: start - issue[1].length - 1, end: start };
  const skill = /(?:^|\s)\/([\w-]*)$/u.exec(before);
  return skill ? { kind: 'skill', query: skill[1], start: start - skill[1].length - 1, end: start } : null;
}

export function rankSkills(skills, query) {
  const wanted = query.toLowerCase();
  const matches = (name) => {
    let position = 0;
    for (const character of name.toLowerCase()) if (character === wanted[position]) position++;
    return position === wanted.length;
  };
  return skills.filter((skill) => matches(skill.name)).sort((a, b) =>
    Number(b.name.toLowerCase().startsWith(wanted)) - Number(a.name.toLowerCase().startsWith(wanted)));
}

export const issueAddress = (issue) => issue.ref ?? `#${issue.id}`;

export function addressedMessage(text) {
  const value = text.trimStart();
  if (!value.startsWith('@')) return null;
  const match = /^@(#?[1-9]\d{0,14}|[A-Za-z]{1,3}-[1-9]\d{0,14})(?=\s|$)/u.exec(value);
  if (!match) return { error: 'recipient_unavailable' };
  const body = value.slice(match[0].length).trim();
  return body ? { id: match[1], body } : { error: 'empty_request' };
}

// What the box holds after the owner chose to answer an issue (回复 in the menu of a message, or on an opened row of the todo card): its @ in front of what is written, or in place of the @ that starts it
// (only a leading @ routes a message).
const LEADING_ADDRESS = /^(\s*)@(?:#?[1-9]\d{0,14}|[A-Za-z]{1,3}-[1-9]\d{0,14})(?=\s|$)/u;
export function replyDraft(draft, issue) {
  const name = issueAddress(issue);
  const found = LEADING_ADDRESS.exec(draft);
  if (found) {
    const rest = draft.slice(found[0].length);
    return `${found[1]}@${name}${rest === '' ? ' ' : rest}`;
  }
  return draft ? `@${name} ${draft}` : `@${name} `;
}

/**
 * The words of a draft that DSH's own box shows in blue: the @address at the start (the only place it routes) and the /name of a skill
 * that DSH lists for the conversation. Everything else stays plain; the parts always join back into the draft.
 */
export function highlightParts(text, skillNames = []) {
  const known = new Set(skillNames);
  const marks = [];
  const address = /^(\s*)(@(?:#?[1-9]\d{0,14}|[A-Za-z]{1,3}-[1-9]\d{0,14}))(?=\s|$)/u.exec(text);
  if (address) marks.push([address[1].length, address[1].length + address[2].length]);
  for (const match of text.matchAll(/(?<=^|\s)\/([\w-]+)(?=\s|$)/gu)) if (known.has(match[1])) marks.push([match.index, match.index + match[0].length]);
  const parts = [];
  let at = 0;
  for (const [start, end] of marks.sort((a, b) => a[0] - b[0])) {
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: text.slice(start, end), mark: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
