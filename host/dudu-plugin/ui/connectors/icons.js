// What a connector's `icon` key stands for. Every service Dudu ships has one: its logo (the brand mark, on the white tile) or a plain symbol. The catalog's own services
// are imported here; the logos of the other common services (Lark, Stripe, QQ, WeChat and so on: the owner, 2026-11-07) are collected by scripts/collect-brand-logos.mjs
// into brand-logos.js, and host/assistant/connectors/brands.mjs says which name is which service. The logos are the CC0 "SVG Logos" set (gilbarbara/logos), Simple Icons
// (CC0), devicon's Canva, Ant Design's and TDesign's DingTalk and WeCom (MIT) and Wikimedia Commons' Lark (icons/NOTICE.md); trademarks stay with their owners, and the
// marks are here only so that a row can be told from the next.
import { Globe, PenTool, Plug, Terminal } from 'lucide-react';
import airtable from './icons/airtable.svg';
import atlassian from './icons/atlassian.svg';
import canva from './icons/canva.svg';
import github from './icons/github.svg';
import gitlab from './icons/gitlab.svg';
import gmail from './icons/gmail.svg';
import googlecalendar from './icons/googlecalendar.svg';
import googledrive from './icons/googledrive.svg';
import linear from './icons/linear.svg';
import notion from './icons/notion.svg';
import sentry from './icons/sentry.svg';
import supabase from './icons/supabase.svg';
import vercel from './icons/vercel.svg';
import { BRAND_LOGOS } from './brand-logos.js';

export const ICONS = {
  airtable: { src: airtable },
  atlassian: { src: atlassian },
  canva: { src: canva },
  github: { src: github },
  gitlab: { src: gitlab },
  gmail: { src: gmail },
  googlecalendar: { src: googlecalendar },
  googledrive: { src: googledrive },
  linear: { src: linear },
  notion: { src: notion },
  sentry: { src: sentry },
  supabase: { src: supabase },
  vercel: { src: vercel },
  ...BRAND_LOGOS,
  browser: { Glyph: Globe },
  pencil: { Glyph: PenTool },
  // what the owner added by hand, or what was found on this computer: a service somewhere else, or a command
  plug: { Glyph: Plug },
  terminal: { Glyph: Terminal },
};

const REMOTE = ICONS.plug;
const LOCAL = ICONS.terminal;

/**
 * The icon of a connector or of a catalog item: the one its key names. Without one it is a plug (a service somewhere else, which is what a custom
 * address is) or a terminal (a command, or a sentence about how to read), as `about.kind` or the catalog group says.
 */
export function iconFor(key, fallback = 'local') {
  return ICONS[key] ?? (fallback === 'remote' ? REMOTE : LOCAL);
}
