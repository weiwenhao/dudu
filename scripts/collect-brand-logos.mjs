// Collects the logos of common services for the pictures on collected records and connectors (owner, 2026-11-07: "lark/stripe/qq/wechat 等等常见的 logo 可以采集预设下来"):
// a record that comes from Lark, Stripe, QQ, WeChat and so on shows the service's own mark, and the first letter of the collector's name only where there is none.
// Run by hand (it needs the network and Chrome); what it writes is committed, so neither the build nor the plugin needs either:
//   node scripts/collect-brand-logos.mjs          everything
//   node scripts/collect-brand-logos.mjs --apps   only the icons of apps installed on this Mac (no network; one that is not installed keeps its committed file)
// -> host/dudu-plugin/ui/connectors/icons/<key>.svg | .png (the logo, in colour) and host/dudu-plugin/ui/connectors/brand-logos.js (what the interface imports).
// Sources (the marks stay with their owners; icons/NOTICE.md says so): SVG Logos (gilbarbara/logos, CC0), Simple Icons (CC0, drawn here in the brand's own colour),
// Ant Design Icons and TDesign Icons through Iconify (MIT), Wikimedia Commons for Lark (public domain). Which service has which key, and what a name has to say to be
// taken for it, is host/assistant/connectors/brands.mjs.
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icons = join(root, 'host', 'dudu-plugin', 'ui', 'connectors', 'icons');
const SIMPLE_ICONS = '16.36.0';
const appsOnly = process.argv.includes('--apps');

// key -> file of the SVG Logos collection (the icon-only mark where it has one)
const GILBARBARA = {
  slack: 'slack-icon', microsoftteams: 'microsoft-teams', linkedin: 'linkedin-icon', salesforce: 'salesforce', zoom: 'zoom-icon', jira: 'jira', confluence: 'confluence',
  dropbox: 'dropbox', paypal: 'paypal', shopify: 'shopify', zendesk: 'zendesk-icon', discord: 'discord-icon', telegram: 'telegram', whatsapp: 'whatsapp-icon', asana: 'asana-icon',
  trello: 'trello', figma: 'figma', datadog: 'datadog-icon', pagerduty: 'pagerduty-icon', x: 'x', googlemeet: 'google-meet',
};
// key -> slug of Simple Icons: one colour, drawn here in the brand's own
const SIMPLE = { stripe: 'stripe', hubspot: 'hubspot', intercom: 'intercom', mailchimp: 'mailchimp', qq: 'qq', wechat: 'wechat', alipay: 'alipay', icloud: 'icloud', protonmail: 'protonmail' };
// key -> [Iconify set, icon, the brand's colour]
const ICONIFY = { dingtalk: ['ant-design', 'dingtalk-circle-filled', '#3296FA'], wecom: ['tdesign', 'logo-wecom-filled', '#0082EF'] };
// key -> a picture of the logo
const COMMONS = { lark: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Lark_Suite_logo_2022.png' };
// key -> the icon file of an app installed on this Mac. None now: WeChat's came from WeChat.app until 2026-11-11, and is Simple Icons' CC0 mark like QQ's.
const APP_ICONS = {};

// curl, not fetch: it goes through the proxy the owner's machine is set to (HTTPS_PROXY), which Node's fetch does not.
const get = async (url) => execFileSync('curl', ['-sfL', '--max-time', '60', url], { maxBuffer: 64 * 1024 * 1024 });
const tidy = (svg) => svg.replace(/<\?xml[^>]*\?>\s*/u, '').replace(/\s(?:width|height)="1em"/gu, '').trim();

const work = await mkdtemp(join(tmpdir(), 'dudu-brands-'));
try {
  await mkdir(icons, { recursive: true });
  if (!appsOnly) {
    for (const [key, name] of Object.entries(GILBARBARA)) {
      await writeFile(join(icons, `${key}.svg`), `${tidy((await get(`https://raw.githubusercontent.com/gilbarbara/logos/main/logos/${name}.svg`)).toString('utf8'))}\n`);
    }
    execFileSync('npm', ['pack', `simple-icons@${SIMPLE_ICONS}`, '--silent', '--pack-destination', work], { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
    execFileSync('tar', ['-xzf', join(work, `simple-icons-${SIMPLE_ICONS}.tgz`), '-C', work]);
    const meta = Object.fromEntries(JSON.parse(await readFile(join(work, 'package', 'data', 'simple-icons.json'), 'utf8')).map((item) => [item.slug, item]));
    for (const [key, slug] of Object.entries(SIMPLE)) {
      const path = /<path d="([^"]+)"/u.exec(await readFile(join(work, 'package', 'icons', `${slug}.svg`), 'utf8'))?.[1];
      if (!path || !meta[slug]) throw new Error(`Simple Icons has no ${slug}`);
      await writeFile(join(icons, `${key}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#${meta[slug].hex}" d="${path}"/></svg>\n`);
    }
    for (const [key, [set, name, color]] of Object.entries(ICONIFY)) {
      await writeFile(join(icons, `${key}.svg`), `${tidy((await get(`https://api.iconify.design/${set}/${name}.svg`)).toString('utf8')).replaceAll('currentColor', color)}\n`);
    }
  }

  // A logo that is a picture: cropped to the mark (what is neither clear nor white), 192 points square, a margin of 6% round it. Lark's is on its own white (the tile
  // it sits on is white); an app's icon keeps its clear corners.
  const pictures = [];
  if (!appsOnly) for (const [key, url] of Object.entries(COMMONS)) pictures.push({ key, bytes: await get(url), fill: '#fff' });
  for (const [key, file] of Object.entries(APP_ICONS)) {
    if (!existsSync(file)) { console.warn(`${key}: ${file} is not on this Mac, its committed file stays`); continue; }
    const converted = join(work, `${key}-app.png`);
    execFileSync('sips', ['-s', 'format', 'png', file, '--out', converted], { stdio: ['ignore', 'ignore', 'inherit'] });
    pictures.push({ key, bytes: await readFile(converted), fill: null });
  }
  if (pictures.length) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage();
      for (const { key, bytes, fill } of pictures) {
        await page.setContent('<!doctype html><body></body>');
        const data = await page.evaluate(async ({ base64, background }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const source = document.createElement('canvas');
          source.width = image.naturalWidth;
          source.height = image.naturalHeight;
          const context = source.getContext('2d');
          context.drawImage(image, 0, 0);
          const { data: pixels, width, height } = context.getImageData(0, 0, source.width, source.height);
          let [left, top, right, bottom] = [width, height, 0, 0];
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const at = (y * width + x) * 4;
              if (pixels[at + 3] > 64 && (pixels[at] < 245 || pixels[at + 1] < 245 || pixels[at + 2] < 245)) {
                left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
              }
            }
          }
          const [cropWidth, cropHeight] = [right - left + 1, bottom - top + 1];
          const out = document.createElement('canvas');
          out.width = 192;
          out.height = 192;
          const draw = out.getContext('2d');
          if (background) {
            draw.fillStyle = background;
            draw.fillRect(0, 0, 192, 192);
          }
          const scale = (192 - 2 * Math.round(192 * 0.06)) / Math.max(cropWidth, cropHeight);
          draw.imageSmoothingQuality = 'high';
          draw.drawImage(source, left, top, cropWidth, cropHeight, (192 - cropWidth * scale) / 2, (192 - cropHeight * scale) / 2, cropWidth * scale, cropHeight * scale);
          return out.toDataURL('image/png').split(',')[1];
        }, { base64: bytes.toString('base64'), background: fill });
        await writeFile(join(icons, `${key}.png`), Buffer.from(data, 'base64'));
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

// What the interface imports: one line for each of the logos collected here (the older ones, from the catalog's, are imported by icons.js itself).
const sorted = [...Object.keys(GILBARBARA), ...Object.keys(SIMPLE), ...Object.keys(ICONIFY), ...Object.keys(COMMONS), ...Object.keys(APP_ICONS)].sort();
const extension = (key) => (Object.hasOwn(COMMONS, key) || Object.hasOwn(APP_ICONS, key) ? 'png' : 'svg');
for (const key of sorted) if (!existsSync(join(icons, `${key}.${extension(key)}`))) throw new Error(`icons/${key}.${extension(key)} is missing: run this script without --apps first`);
const body = `// Generated by scripts/collect-brand-logos.mjs: the logos of common services (icons/NOTICE.md says where they come from). Do not edit.
${sorted.map((key) => `import ${key} from './icons/${key}.${extension(key)}';`).join('\n')}

export const BRAND_LOGOS = {
${sorted.map((key) => `  ${key}: { src: ${key} },`).join('\n')}
};
`;
await writeFile(join(root, 'host', 'dudu-plugin', 'ui', 'connectors', 'brand-logos.js'), body);
console.log(`${sorted.length} logos: ${sorted.join(' ')}`);
