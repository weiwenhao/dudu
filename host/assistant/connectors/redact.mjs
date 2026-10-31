// Keeping secrets out of everything the connectors library returns, writes or logs (docs/assistant.md 3.1, verification 7).
//
// Two layers. Showing something to a person or to the model (a launch command, a URL) goes through the redactors, which
// mask what looks like a secret by its name or its shape. Whatever the library actually resolved to start a process or
// send a header goes into the scrubber, and every string that leaves the library passes through it, so a value that
// slipped past the heuristics still cannot come back out as long as it was a value the library handled.
export const MASK = '***';

// Names that usually carry a credential: TOKEN, API_KEY, Authorization, X-Api-Key, PASSWORD, GITHUB_PAT ...
const SECRET_NAME = /token|secret|passw|credential|bearer|cookie|auth|api[-_]?key|apikey|private[-_]?key|access[-_]?key|signature|(?:^|[-_.])(?:key|pat|pwd|sig)$/i;
// Shapes that are credentials whatever they are called: provider prefixes, JWTs, long random-looking strings.
const SECRET_SHAPE = /^(?:sk-|sk_|rk_|pk_live|pk_test|gh[pousr]_|github_pat_|glpat-|xox[abprs]-|xapp-|AKIA|ASIA|AIza|ya29\.|ntn_|secret_|dt_|Bearer\s|Basic\s|eyJ[\w-]{8,}\.)/;

export const looksSecretName = (name) => SECRET_NAME.test(String(name));

export function looksSecretValue(value) {
  const text = String(value);
  if (SECRET_SHAPE.test(text) || /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(text)) return true; // a prefix, or a URL with a password in it
  if (/^(?:[/~]|\.{1,2}[/\\]|[A-Za-z]:[/\\])/.test(text)) return false; // a path is long and mixed, and not a credential
  return /^[A-Za-z0-9+/_=-]{32,}$/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text);
}

// A URL for display: no user info, no fragment, and masked query values and path segments that look like credentials.
// `found` is called with each piece that was masked, so the caller can remember it.
export function redactUrl(value, found = () => {}) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    if (!looksSecretValue(value)) return String(value);
    found(String(value));
    return MASK;
  }
  if (url.username || url.password) {
    for (const part of [url.username, url.password]) if (part) found(decodeURIComponent(part));
    url.username = MASK;
    url.password = url.password ? MASK : '';
  }
  for (const [key, entry] of [...url.searchParams]) {
    if (!looksSecretName(key) && !looksSecretValue(entry)) continue;
    found(entry);
    url.searchParams.set(key, MASK);
  }
  url.pathname = url.pathname.split('/').map((part) => {
    if (!looksSecretValue(part)) return part;
    found(part);
    return MASK;
  }).join('/');
  url.hash = '';
  return url.toString();
}

// Launch arguments for display: the value after a flag called --token or --api-key, `--password=…`, anything shaped like
// a credential, and credentials inside URLs.
export function redactArgs(args, found = () => {}) {
  const isUrl = (text) => /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const mask = (text) => {
    found(text);
    return MASK;
  };
  const out = [];
  let hide = false;
  for (const arg of args) {
    const text = String(arg);
    if (hide) {
      out.push(mask(text));
      hide = false;
      continue;
    }
    const flag = /^(--?[\w.-]+)(=(.*))?$/s.exec(text);
    if (!flag) {
      out.push(isUrl(text) ? redactUrl(text, found) : looksSecretValue(text) ? mask(text) : text);
    } else if (looksSecretName(flag[1])) {
      if (flag[2] === undefined) hide = true;
      out.push(flag[2] === undefined ? text : `${flag[1]}=${mask(flag[3])}`);
    } else if (flag[2] === undefined) {
      out.push(text);
    } else {
      out.push(`${flag[1]}=${isUrl(flag[3]) ? redactUrl(flag[3], found) : looksSecretValue(flag[3]) ? mask(flag[3]) : flag[3]}`);
    }
  }
  return out;
}

// Remembers the secret values the library handled and masks them in any string, or in every string of a nested value.
export function createScrubber(limit = 1000) {
  const values = new Set();
  const remember = (value) => {
    if (typeof value !== 'string' || value.length < 6) return;
    for (const form of new Set([value, encodeURIComponent(value)])) {
      values.delete(form);
      values.add(form);
    }
    while (values.size > limit) values.delete(values.values().next().value);
  };
  const scrub = (text) => {
    let out = text;
    for (const value of [...values].sort((a, b) => b.length - a.length)) if (out.includes(value)) out = out.split(value).join(MASK);
    return out;
  };
  const deep = (value) => {
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map(deep);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deep(entry)]));
    return value;
  };
  return { remember, scrub, deep };
}
