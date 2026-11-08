import { ICONS } from '../connectors/icons.js';
import { Tile } from '../connectors/Tile.jsx';

const TONES = 7;

/** Which of the seven tones (styles.css, `--tone-N-*`) a name gets: the same name, the same tone, here and on the phone (its `ConnectorAvatar` makes the same sum). */
export function toneOf(name) {
  let sum = 0;
  for (const char of String(name ?? '')) sum = (sum * 31 + char.codePointAt(0)) >>> 0;
  return sum % TONES;
}

/** The first letter of a name in capitals; a character of Chinese is itself. */
export function initialOf(name) {
  const first = [...String(name ?? '').trim()][0];
  return first ? first.toUpperCase() : '?';
}

/**
 * Where a record comes from, as a small picture (the owner, 2026-11-07): the service's own mark when the plugin names one for the record (the catalog's connector it reads
 * through, or a service its name says: Lark, Stripe, QQ, WeChat and so on; `host/assistant/connectors/brands.mjs`), and otherwise the first letter of the collector's name
 * on a soft colour its name picks. `icon` is the card's `connectorIcon`.
 */
export function ConnectorAvatar({ icon, name, size = 28 }) {
  const known = ICONS[icon];
  const radius = Math.round(size * 0.29);
  if (known?.src) return <Tile icon={known} size={size} radius={radius} />;
  const tone = toneOf(name);
  return (
    <span
      aria-hidden="true" className="flex shrink-0 items-center justify-center font-semibold select-none"
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.46), background: `var(--tone-${tone}-bg)`, color: `var(--tone-${tone}-fg)` }}
    >
      {initialOf(name)}
    </span>
  );
}
