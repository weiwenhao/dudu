// Where an issue that came from a collector came from, for the issue's page (docs/assistant.md 3.2, the "来源" group of the properties):
// the collector's name and the link of the record it was made from. An older issue has only a link in its sourceRef; one with no link at all
// has no source to open.
//
//   sourceOf({ issue, issues, collectors }) -> { connector, name, url, from, at, title } | null     (`connector` is the id of the collector)
const LINK = /https?:\/\/[^\s"'<>)\]]+/;

export function sourceOf({ issue, issues, collectors }) {
  if (!issue || issue.source !== 'connector') return null;
  const connector = String(issue.sourceRef ?? '').split(':', 1)[0];
  const records = issues.inbox?.forIssue(issue.id) ?? [];
  const record = records.find((entry) => entry.verdict === 'issue' && entry.url) ?? records.find((entry) => entry.url) ?? null;
  const url = record?.url || LINK.exec(String(issue.sourceRef ?? ''))?.[0] || '';
  if (!url) return null;
  let name = connector;
  try {
    name = collectors?.dudu.list().collectors?.find((entry) => entry.id === connector)?.name ?? connector;
  } catch { /* the registry is not readable: the id is the name */ }
  return { connector, name, url, from: record?.from ?? '', at: record?.at ?? null, title: record?.title ?? '' };
}
