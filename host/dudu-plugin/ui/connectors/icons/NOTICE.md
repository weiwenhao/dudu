# Connector icons

The logos in this folder only tell services apart: on the connectors page, and on every collected record (the picture before its title; the phone has the same ones as image sets, rendered by `scripts/render-connector-icons.mjs`). The marks belong to their owners; the licence of the sets below covers the files, not the marks.

- The catalog's services: `notion`, `gmail`, `googlecalendar`, `googledrive`, `linear`, `atlassian`, `github`, `gitlab`, `sentry`, `supabase`, `vercel`, `airtable`: SVG Logos (https://github.com/gilbarbara/logos, CC0 1.0), taken from `@iconify-json/logos` 1.2.19. `canva`: devicon (https://github.com/devicons/devicon, MIT). `ego`: ego lite's own mark (https://www.ego.app/icon.svg, 2026-11-21, its black light-mode fill — the one the macOS app icon also uses), its dark-mode variant dropped since the tile this sits on is always white.
- The other common services, collected by `scripts/collect-brand-logos.mjs` (2026-11-07):
  - SVG Logos (CC0 1.0): `slack`, `microsoftteams`, `linkedin`, `salesforce`, `zoom`, `jira`, `confluence`, `dropbox`, `paypal`, `shopify`, `zendesk`, `discord`, `telegram`, `whatsapp`, `asana`, `trello`, `figma`, `datadog`, `pagerduty`, `x`, `googlemeet`.
  - Simple Icons 16.36.0 (https://github.com/simple-icons/simple-icons, CC0 1.0), one colour, drawn in the brand's own: `stripe`, `hubspot`, `intercom`, `mailchimp`, `qq`, `wechat`, `alipay`, `icloud`, `protonmail`.
  - `dingtalk`: Ant Design Icons (https://github.com/ant-design/ant-design-icons, MIT), `dingtalk-circle-filled`, in #3296FA. `wecom`: TDesign Icons (https://github.com/Tencent/tdesign-icons, MIT), `logo-wecom-filled`, in #0082EF. Both through Iconify (https://iconify.design).
  - `lark`: Wikimedia Commons, "File:Lark Suite logo 2022.png" (public domain, trademarked), cropped to the mark.

Which name is taken for which service is `host/assistant/connectors/brands.mjs`. A custom connector that is just "a browser", and Pencil, use Lucide symbols (ISC), drawn in the code.
