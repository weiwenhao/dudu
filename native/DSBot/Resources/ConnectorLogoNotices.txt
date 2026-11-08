# Connector icons

The logos in this folder only tell services apart: on the connectors page, and on every collected record (the picture before its title; the phone has the same ones as image sets, rendered by `scripts/render-connector-icons.mjs`). The marks belong to their owners; the licence of the sets below covers the files, not the marks.

- The catalog's services: `notion`, `gmail`, `googlecalendar`, `googledrive`, `linear`, `atlassian`, `github`, `gitlab`, `sentry`, `supabase`, `vercel`, `airtable`: SVG Logos (https://github.com/gilbarbara/logos, CC0 1.0), taken from `@iconify-json/logos` 1.2.19. `canva`: devicon (https://github.com/devicons/devicon, MIT).
- The other common services, collected by `scripts/collect-brand-logos.mjs` (2026-11-07):
  - SVG Logos (CC0 1.0): `slack`, `microsoftteams`, `linkedin`, `salesforce`, `zoom`, `jira`, `confluence`, `dropbox`, `paypal`, `shopify`, `zendesk`, `discord`, `telegram`, `whatsapp`, `asana`, `trello`, `figma`, `datadog`, `pagerduty`, `x`, `googlemeet`.
  - Simple Icons 16.36.0 (https://github.com/simple-icons/simple-icons, CC0 1.0), one colour, drawn in the brand's own: `stripe`, `hubspot`, `intercom`, `mailchimp`, `qq`, `alipay`, `icloud`, `protonmail`.
  - `dingtalk`: Ant Design Icons (https://github.com/ant-design/ant-design-icons, MIT), `dingtalk-circle-filled`, in #3296FA. `wecom`: TDesign Icons (https://github.com/Tencent/tdesign-icons, MIT), `logo-wecom-filled`, in #0082EF. Both through Iconify (https://iconify.design).
  - `lark`: Wikimedia Commons, "File:Lark Suite logo 2022.png" (public domain, trademarked), cropped to the mark.
  - `wechat`: the icon of WeChat.app (Tencent's own artwork and trademark, not from a free-to-copy set), cropped to the square, taken from the app on the owner's Mac on 2026-11-07 at the owner's word. If this folder is ever published, this is the one file to look at again: Simple Icons' `wechat` glyph is the same mark in one colour, free to copy.

Which name is taken for which service is `host/assistant/connectors/brands.mjs`. The browser and Pencil use Lucide symbols (ISC), drawn in the code.
