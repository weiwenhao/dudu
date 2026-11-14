// Which service a name is about, so that a record or a connector can show that service's own logo (owner, 2026-11-07: "lark/stripe/qq/wechat 等等常见的 logo 可以采集预设下来").
// The logos are collected by scripts/collect-brand-logos.mjs (and, for the catalog's own services, are the files that were here before) into
// host/dudu-plugin/ui/connectors/icons/<key>.svg | .png; the key is the file's name. A name is taken for a service when it says one of the service's names: a Latin name
// as a word of its own (so `qq` is in "qq-mail" and not in "qqq"), a Chinese name anywhere. A name that says two services is about the one it says first.
//
//   brandOf('飞书 @我')                    -> 'lark'
//   brandOf('Alerts', 'sentry-prod')       -> 'sentry'   (the first text that names a service decides; later ones are asked only when it names none)
//   brandOf('Notion 同步到 Slack')          -> 'notion'   (the one said first, not the one that is earlier in the table)
//   brandOf('我的收件箱')                   -> null
//   brandOf('QQ 邮箱')                      -> null       (QQ's mailbox is a service of its own, not the chat app: no logo of ours, so the avatar is the name's first letter)
//
// The order of the table breaks a tie, where two names start at the same place: a service whose name contains another's comes first (WeCom's "wechat work" before WeChat,
// QQ's mailbox before QQ). A name is a string, or a pattern where one word is not enough; a null key is a service that has no logo here and must not be taken for the one
// it is named after: the other apps of a maker that are not its chat (owner, 2026-11-12, on "QQ 邮箱" wearing the QQ penguin: "这是 QQ 的头像，不是邮箱的头像").
export const BRANDS = Object.freeze([
  ['lark', ['lark', 'larksuite', 'lark suite', 'feishu', '飞书']],
  ['wecom', ['wecom', 'wechat work', 'wxwork', '企业微信', '企微']],
  [null, [/微信读书/u, 'weread']],
  ['wechat', ['wechat', 'weixin', '微信']],
  ['dingtalk', ['dingtalk', 'dingding', '钉钉']],
  [null, [/(?<![a-z0-9])qq[\s_-]*(?:邮箱|邮件|mail|音乐|music|浏览器|browser|空间|zone)/u]],
  ['qq', ['qq', '腾讯qq']],
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
// A Latin name is a word of its own (letters and digits do not run on from it); a name in Chinese is found anywhere in the text. Each gives the place where it starts, or -1.
const matchers = BRANDS.map(([key, names]) => [key, names.map((name) => {
  if (name instanceof RegExp) return (text) => text.search(name);
  if (!/^[a-z0-9 .]+$/u.test(name)) return (text) => text.indexOf(name);
  const word = new RegExp(`(?<![a-z0-9])${name.split(/\s+/u).map(escape).join('\\s+')}(?![a-z0-9])`, 'u');
  return (text) => text.search(word);
})]);

/** The key of the service the first of these texts is about (a text that says two is about the one it says first), or null when none is about one. */
export function brandOf(...texts) {
  for (const raw of texts) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const text = raw.normalize('NFKC').toLowerCase();
    let first = null; // [where, key]: the earliest, and on a tie the one that is earlier in the table
    for (const [key, places] of matchers) {
      for (const at of places) {
        const where = at(text);
        if (where >= 0 && (first === null || where < first[0])) first = [where, key];
      }
    }
    if (first) return first[1];
  }
  return null;
}
