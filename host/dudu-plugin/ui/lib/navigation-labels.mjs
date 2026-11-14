/** Read DSH's registered dictionaries without switching its active language or publishing changes.
 * Older hosts or third-party labels without an unambiguous dictionary entry keep their own text.
 */
export function navigationLabelTranslations(locale, options, title) {
  if (typeof options?.label !== 'function' || typeof options.locale !== 'string') return undefined;
  const dictionaries = locale?.dicts?.get?.(options.locale);
  const active = locale?.getLocale?.().active;
  if (!dictionaries?.get) return undefined;
  const chain = locale.fallbackChain?.(active) ?? [active, 'en'];
  const current = Object.assign(Object.create(null), ...[...chain].reverse().map((language) => dictionaries.get(language)));
  const keys = Object.keys(current).filter((key) => current[key] === title);
  if (!keys.length) return undefined;
  const titles = {};
  for (const language of ['en', 'zh']) {
    const dict = dictionaries.get(language);
    const values = new Set(keys.map((key) => dict?.[key]).filter((value) => typeof value === 'string' && value.trim()));
    if (values.size === 1) titles[language] = [...values][0];
  }
  return Object.keys(titles).length ? titles : undefined;
}
