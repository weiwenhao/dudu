const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Match only the library's complete diagnostic templates; captured field names and values stay intact.
export function compileDiagnostics(dictionary) {
  const fixed = new Map();
  const templates = [];
  for (const [group, entries] of Object.entries(dictionary)) {
    for (const [key, message] of Object.entries(entries)) {
      const path = [group, key];
      if (typeof message === 'string') { fixed.set(message, { path, args: [] }); continue; }
      const markers = Array.from({ length: message.length }, (_, index) => `__DUDU_DIAGNOSTIC_${index}__`);
      let pattern = escape(message(...markers));
      for (const marker of markers) pattern = pattern.replace(marker, '([\\s\\S]*?)');
      templates.push({ path, pattern: new RegExp(`^${pattern}$`) });
    }
  }
  return (text) => {
    if (fixed.has(text)) return fixed.get(text);
    for (const { path, pattern } of templates) {
      const match = pattern.exec(text);
      if (match) return { path, args: match.slice(1) };
    }
    return null;
  };
}
