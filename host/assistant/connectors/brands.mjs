// Which service a name is about, so that a record or a connector can show that service's own logo (owner, 2026-11-07: "lark/stripe/qq/wechat 等等常见的 logo 可以采集预设下来").
// The logos are collected by scripts/collect-brand-logos.mjs (and, for the catalog's own services, are the files that were here before) into
// host/dudu-plugin/ui/connectors/icons/<key>.svg | .png; the key is the file's name. A name is taken for a service when it says one of the service's names: a Latin name
// as a word of its own (so `qq` is in "QQ 邮箱" and in "qq-mail" and not in "qqq"), a Chinese name anywhere.
//
//   brandOf('飞书 @我')                    -> 'lark'
//   brandOf('Alerts', 'sentry-prod')       -> 'sentry'   (the first text that names a service decides; later ones are asked only when it names none)
//   brandOf('我的收件箱')                   -> null
//
// The order of the table is the order of asking: a service whose name contains another's comes first (WeCom's "wechat work" before WeChat).
export const BRANDS = Object.freeze([
  ['lark', ['lark', 'larksuite', 'lark suite', 'feishu', '飞书']],
  ['wecom', ['wecom', 'wechat work', 'wxwork', '企业微信', '企微']],
  ['wechat', ['wechat', 'weixin', '微信']],
  ['dingtalk', ['dingtalk', 'dingding', '钉钉']],
  ['qq', ['qq', 'qqmail', '腾讯qq']],
  ['alipay', ['alipay', '支付宝']],
  ['slack', ['slack']],
  ['microsoftteams', ['microsoft teams', 'ms teams', 'msteams']],
  ['discord', ['discord']],
  ['telegram', ['telegram', '电报']],
  ['whatsapp', ['whatsapp']],
  ['zoom', ['zoom']],
  ['googlemeet', ['google meet', 'gmeet']],
  ['googlecalendar', ['google calendar', 'gcal', 'google 日历', '谷歌日历']],
  ['googledrive', ['google drive', 'gdrive', 'google 云端硬盘', '谷歌云盘']],
  ['gmail', ['gmail', 'google mail']],
  ['icloud', ['icloud']],
  ['protonmail', ['protonmail', 'proton mail']],
  ['stripe', ['stripe']],
  ['paypal', ['paypal']],
  ['shopify', ['shopify']],
  ['hubspot', ['hubspot']],
  ['salesforce', ['salesforce']],
  ['intercom', ['intercom']],
  ['zendesk', ['zendesk']],
  ['mailchimp', ['mailchimp']],
  ['linkedin', ['linkedin', '领英']],
  ['x', ['twitter', 'x.com', '推特']],
  ['notion', ['notion']],
  ['linear', ['linear']],
  ['jira', ['jira']],
  ['confluence', ['confluence']],
  ['atlassian', ['atlassian']],
  ['asana', ['asana']],
  ['trello', ['trello']],
  ['airtable', ['airtable']],
  ['figma', ['figma']],
  ['canva', ['canva']],
  ['dropbox', ['dropbox']],
  ['github', ['github']],
  ['gitlab', ['gitlab']],
  ['sentry', ['sentry']],
  ['datadog', ['datadog']],
  ['pagerduty', ['pagerduty']],
  ['vercel', ['vercel']],
  ['supabase', ['supabase']],
]);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
// A Latin name is a word of its own (letters and digits do not run on from it); a name in Chinese is found anywhere in the text.
const matchers = BRANDS.map(([key, names]) => [key, names.map((name) => (/^[a-z0-9 .]+$/u.test(name)
  ? new RegExp(`(?<![a-z0-9])${name.split(/\s+/u).map(escape).join('\\s+')}(?![a-z0-9])`, 'u')
  : { test: (text) => text.includes(name) }))]);

/** The key of the service the first of these texts is about, or null when none is about one. */
export function brandOf(...texts) {
  for (const raw of texts) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const text = raw.normalize('NFKC').toLowerCase();
    for (const [key, tests] of matchers) if (tests.some((test) => test.test(text))) return key;
  }
  return null;
}
