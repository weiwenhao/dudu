// What a connector's `icon` key stands for. Every service Dudu ships has one: its logo (the brand mark, on the white tile) or a plain symbol. A connector with neither (the
// owner added it by hand, or it was found on this computer: the plugin's keys `plug` and `terminal`, which name no service) has no entry here and is drawn with the first
// letter of its name (`ConnectorMark`), as the Collector and the phone draw it. The catalog's own services
// are imported here; the logos of the other common services (Lark, Stripe, QQ, WeChat and so on: the owner, 2026-11-07) are collected by scripts/collect-brand-logos.mjs
// into brand-logos.js, and host/assistant/connectors/brands.mjs says which name is which service. The logos are the CC0 "SVG Logos" set (gilbarbara/logos), Simple Icons
// (CC0), devicon's Canva, Ant Design's and TDesign's DingTalk and WeCom (MIT) and Wikimedia Commons' Lark (icons/NOTICE.md); trademarks stay with their owners, and the
// marks are here only so that a row can be told from the next.
import { Globe, PenTool } from 'lucide-react';
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
};
