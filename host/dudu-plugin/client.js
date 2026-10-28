window.__ModuleLoader__.load({
  id: 'dudu',
  factory(require) {
    const { createElement: h, Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } = require('react');
    const { Button, Input } = require('@deepseek-ai/dsh-client-ui-primitives');

    const styles = `
.dsbot-settings{max-width:760px;padding:0 0 24px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.dsbot-settings *{box-sizing:border-box}.dsbot-settings h2{font-size:20px;font-weight:500;line-height:28px;margin:0 0 20px}.dsbot-settings h3{font-size:14px;font-weight:500;line-height:20px;margin:20px 0 0}
.dsbot-settings-section{display:flex;flex-direction:column;width:100%}.dsbot-settings-row{display:grid;grid-template-columns:minmax(120px,1fr) minmax(0,2fr);align-items:center;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsbot-field-title{font-size:14px;line-height:20px}
.dsbot-input{display:flex;width:100%;max-width:100%;min-width:0;box-sizing:border-box}
.dsbot-input input{flex:1 1 auto;width:100%;min-width:0;box-sizing:border-box}
.dsbot-input input[readonly]{color:var(--dsw-alias-label-secondary)}
.dsbot-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px}.dsbot-muted{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}.dsbot-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:12px 0 0}
.dsbot-addresses{display:flex;flex-direction:column}.dsbot-address-row,.dsbot-address-row--default{grid-template-columns:minmax(120px,1fr) minmax(0,2fr)}
.dsbot-address-field{display:flex;align-items:center;gap:12px;min-width:0}.dsbot-address-field .dsbot-input{flex:1 1 auto;min-width:0}.dsbot-address-field .dsbot-button,.dsbot-address-field .dsbot-danger-button{flex:none;white-space:nowrap}.dsbot-danger-button{color:var(--dsw-alias-state-error-primary)!important}
.dsbot-device{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}.dsbot-device-copy{min-width:0;overflow-wrap:anywhere}.dsbot-device .dsbot-button{flex:none}
.dsbot-empty{padding:16px 0;color:var(--dsw-alias-label-secondary)}
.dudu-checkbox{justify-self:start;margin:0;width:16px;height:16px}
.dsbot-dialog-shade{position:fixed;inset:0;background:transparent;border:0;z-index:10000;align-items:center;justify-content:center;padding:24px;width:100%;height:100%;max-width:none;max-height:none;margin:0;color:inherit}.dsbot-dialog-shade[open]{display:flex}.dsbot-dialog-shade::backdrop{background:#0008}.dsbot-dialog{background:var(--dsw-alias-bg-layer-1,#fff);border-radius:var(--dsw-radius-panel);padding:24px;width:360px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto}.dsbot-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}.dsbot-dialog-head h3{margin:0}.dsbot-qr{background:#fff;border-radius:12px;padding:12px}.dsbot-qr svg{display:block;width:100%;height:auto}.dsbot-dialog p{text-align:center;margin:12px 0 0;overflow-wrap:anywhere}
@media(max-width:620px){.dsbot-settings-row{grid-template-columns:minmax(0,1fr);gap:8px}.dsbot-address-row,.dsbot-address-row--default{grid-template-columns:minmax(0,1fr);gap:8px}.dsbot-address-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.dsbot-address-field .dsbot-input{grid-column:1/-1;grid-row:1}.dsbot-address-field .dsbot-button{grid-column:1;grid-row:2}.dsbot-address-field .dsbot-danger-button{grid-column:2;grid-row:2}.dsbot-address-row--default .dsbot-address-field .dsbot-button{grid-column:2}}
`;

    async function request(action, body = {}) {
      const path = new URL(`api/dudu/${action}`, document.baseURI).pathname;
      const response = await fetch(path, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), credentials: 'same-origin',
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || '连接暂时不可用。');
      return value;
    }

    function Dialog({ children, close, label }) {
      const element = useRef(null);
      useEffect(() => {
        const dialog = element.current;
        dialog.showModal();
        return () => dialog.close();
      }, []);
      return h('dialog', {
        ref: element, className: 'dsbot-dialog-shade', 'aria-label': label,
        onCancel: (event) => { event.preventDefault(); close(); },
        onClick: (event) => { if (event.target === event.currentTarget) close(); },
      }, h('section', { className: 'dsbot-dialog' }, children));
    }

    function Settings() {
      const [snapshot, setSnapshot] = useState(null);
      const [draft, setDraft] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [saved, setSaved] = useState(false);
      const [code, setCode] = useState(null);
      const [copyState, setCopyState] = useState('');
      const [confirming, setConfirming] = useState(null);
      const addressId = useRef(0);
      const makeAddressRows = (addresses) => addresses.map((value) => ({ id: ++addressId.current, value }));
      const normalizeAddress = (address) => {
        if (typeof address !== 'string' || !address) return '';
        try {
          const url = new URL(address);
          if (url.protocol === 'ws:') url.protocol = 'http:';
          else if (url.protocol === 'wss:') url.protocol = 'https:';
          if (url.pathname === '/' || url.pathname === '') url.pathname = '/dsbot';
          return url.href;
        } catch { return address; }
      };
      const sameAddress = (left, right) => {
        try { return new URL(left).href === new URL(right).href; }
        catch { return left === right; }
      };
      const addressesFrom = (value) => {
        const addresses = Array.isArray(value.addresses)
          ? value.addresses.filter((address) => typeof address === 'string').map(normalizeAddress)
          : [];
        const lanAddress = normalizeAddress(typeof value.lanAddress === 'string'
          ? value.lanAddress : (addresses[0] || ''));
        const seen = new Set([lanAddress]);
        return {
          lanAddress,
          addresses: addresses.filter((address) => {
            if (sameAddress(address, lanAddress) || seen.has(address)) return false;
            seen.add(address);
            return true;
          }),
        };
      };
      const makeDraft = (value) => {
        const { lanAddress, addresses } = addressesFrom(value);
        return { name: value.name, lanAddress, addresses: makeAddressRows(addresses) };
      };
      useEffect(() => {
        let active = true;
        const refresh = async () => {
          try {
            const value = await request('state');
            if (!active) return;
            setSnapshot(value);
            const next = addressesFrom(value);
            setDraft((previous) => previous === null
              ? { name: value.name, lanAddress: next.lanAddress, addresses: makeAddressRows(next.addresses) }
              : { ...previous, lanAddress: next.lanAddress });
            setCode((previous) => previous && (previous.expiresAt < Date.now()
              || value.devices.some((device) => device.id === previous.id)) ? null : previous);
          } catch (failure) { if (active) setError(failure.message); }
        };
        void refresh();
        const timer = setInterval(refresh, 4000);
        return () => { active = false; clearInterval(timer); };
      }, []);
      useEffect(() => {
        if (!code && !confirming) return;
        const escape = (event) => { if (event.key === 'Escape') { setCode(null); setConfirming(null); } };
        window.addEventListener('keydown', escape);
        return () => window.removeEventListener('keydown', escape);
      }, [code, confirming]);
      const editName = (name) => {
        setDraft((previous) => ({ ...previous, name }));
        setSaved(false); setError('');
      };
      const editAddress = (id, value) => {
        setDraft((previous) => ({
          ...previous, addresses: previous.addresses.map((row) => row.id === id ? { ...row, value } : row),
        }));
        setSaved(false); setError('');
      };
      const addAddress = () => {
        if (draft.addresses.length >= 31) return;
        setDraft((previous) => ({
          ...previous, addresses: [...previous.addresses, { id: ++addressId.current, value: '' }],
        }));
        setSaved(false); setError('');
      };
      const removeAddress = (id) => {
        setDraft((previous) => ({ ...previous, addresses: previous.addresses.filter((row) => row.id !== id) }));
        setSaved(false); setError('');
      };
      const run = async (action, body) => {
        setBusy(true); setError('');
        try {
          const value = await request(action, body);
          if (action === 'generate') {
            setCode(value);
            setCopyState('');
            setSnapshot((previous) => previous && ({
              ...previous, name: draft.name, lanAddress: draft.lanAddress,
              addresses: [draft.lanAddress, ...draft.addresses.map((row) => row.value)],
            }));
            setSaved(true);
          } else {
            setSnapshot(value);
            if (action === 'save') {
              setDraft(makeDraft(value));
              setSaved(true);
            }
          }
          if (action === 'revoke') setConfirming(null);
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
      };
      if (!draft) return h('div', { className: 'dsbot-settings' }, error || '正在读取连接配置…');
      const addressConfig = () => ({
        name: draft.name,
        addresses: [draft.lanAddress, ...draft.addresses.map((row) => row.value)],
      });
      const generateAddress = (address) => run('generate', { ...addressConfig(), address });
      const dialog = (content, close, label) => h(Dialog, { close, label }, content);
      const input = (props) => h(Input, { ...props, className: `dsbot-input${props.className ? ` ${props.className}` : ''}` });
      const button = (props, label) => h(Button, {
        ...props, size: 'sm', className: `dsbot-button${props.className ? ` ${props.className}` : ''}`,
      }, label);
      return h('div', { className: 'dsbot-settings' },
        h('h2', null, '手机控制'),
        h('section', { className: 'dsbot-settings-section' },
          h('div', { className: 'dsbot-settings-row' },
            h('label', { className: 'dsbot-field-title', htmlFor: 'dsbot-computer-name' }, '电脑名称'),
            input({ id: 'dsbot-computer-name', type: 'text', maxLength: 80, value: draft.name,
              'aria-label': '电脑名称', disabled: busy, onChange: (event) => editName(event.target.value) })),
          h('h3', null, '连接地址'),
          h('div', { className: 'dsbot-addresses' },
            h('div', { className: 'dsbot-settings-row dsbot-address-row dsbot-address-row--default', key: 'lan-address' },
              h('label', { className: 'dsbot-field-title', htmlFor: 'dsbot-lan-address' }, '内网地址'),
              h('div', { className: 'dsbot-address-field' },
                input({ id: 'dsbot-lan-address', type: 'text', value: draft.lanAddress, readOnly: true,
                  'aria-label': '内网地址', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }),
                button({ type: 'button', variant: 'primary', disabled: busy || !draft.lanAddress.trim(),
                  'aria-label': '为内网地址生成二维码', onClick: () => generateAddress(draft.lanAddress) },
                busy ? '处理中…' : '生成二维码'))),
            draft.addresses.map((row, index) =>
              h('div', { className: 'dsbot-settings-row dsbot-address-row', key: row.id },
                h('label', { className: 'dsbot-field-title', htmlFor: `dsbot-address-${row.id}` }, `连接地址 ${index + 2}`),
                h('div', { className: 'dsbot-address-field' },
                  input({ id: `dsbot-address-${row.id}`, type: 'url', value: row.value, maxLength: 2048,
                    'aria-label': `连接地址 ${index + 2}`, autoCapitalize: 'none', autoCorrect: 'off',
                    spellCheck: false, disabled: busy, onChange: (event) => editAddress(row.id, event.target.value) }),
                  button({ type: 'button', variant: 'primary', disabled: busy || !row.value.trim(),
                    onClick: () => generateAddress(row.value) },
                  busy ? '处理中…' : '生成二维码'),
                  button({ type: 'button', variant: 'ghost', className: 'dsbot-danger-button', disabled: busy,
                    'aria-label': `删除连接地址 ${index + 2}`, onClick: () => removeAddress(row.id) }, '删除'))))),
          h('div', { className: 'dsbot-actions' },
            button({ type: 'button', variant: 'outline', disabled: busy || draft.addresses.length >= 31, onClick: addAddress }, '添加地址'),
            button({ type: 'button', variant: 'primary', disabled: busy, onClick: () => run('save', addressConfig()) }, '保存'),
            saved && h('span', { className: 'dsbot-muted', role: 'status' }, '已保存')),
          error && h('p', { className: 'dsbot-error', role: 'alert' }, error)),
        h('section', { className: 'dsbot-settings-section' }, h('h3', null, '已配对设备'),
          snapshot.devices.length ? snapshot.devices.map((device) => h('div', { className: 'dsbot-device', key: device.id },
            h('div', { className: 'dsbot-device-copy' }, h('div', null, device.name), h('div', { className: 'dsbot-muted' },
              `配对于 ${new Date(device.pairedAt).toLocaleDateString()}`)),
            button({ type: 'button', variant: 'ghost', className: 'dsbot-danger-button', disabled: busy, onClick: () => setConfirming(device) }, '撤销')))
            : h('div', { className: 'dsbot-empty' }, '暂无配对设备')),
        code && dialog([
          h('div', { className: 'dsbot-dialog-head', key: 'head' },
            h('h3', null, '打开 Dudu 扫码'), button({ type: 'button', variant: 'ghost', onClick: () => setCode(null), autoFocus: true }, '关闭')),
          h('div', { className: 'dsbot-qr', key: 'qr', dangerouslySetInnerHTML: { __html: code.svg } }),
          h('p', { key: 'host' }, new URL(code.url).host),
          h('div', { className: 'dsbot-actions', key: 'copy', style: { justifyContent: 'center', marginTop: 16 } },
            button({ type: 'button', variant: 'primary', onClick: async () => {
              try {
                await navigator.clipboard.writeText(code.url);
                setCopyState('copied');
              } catch {
                setCopyState('failed');
              }
            } }, copyState === 'copied' ? '已复制' : '复制配对链接')),
          copyState === 'failed' && h('p', { className: 'dsbot-error', key: 'copy-error' }, '复制失败，请扫码连接'),
          h('p', { className: 'dsbot-muted', key: 'expiry' }, '二维码 10 分钟内有效'),
        ], () => setCode(null), '配对手机'),
        confirming && dialog([
          h('h3', { key: 'title' }, `撤销 ${confirming.name} 的连接？`),
          h('div', { className: 'dsbot-actions', key: 'actions' },
            button({ type: 'button', variant: 'ghost', disabled: busy, autoFocus: true, onClick: () => setConfirming(null) }, '取消'),
            button({ type: 'button', variant: 'primary', disabled: busy, onClick: () => run('revoke', { id: confirming.id }) }, '撤销配对')),
        ], () => setConfirming(null), '撤销配对'));
    }


    // ---- Navigation: tell the phone what DSH's own UI contains ---------------------------------
    //
    // The sidebar panels, conversation tabs and settings sections are registered in
    // this browser runtime by whichever plugins are installed. Reading them here, rather than listing
    // them in the app, is what lets a plugin's new panel or tab reach the phone unchanged.
    const SETTINGS_ICONS = {
      account: 'IconUserOutlineMedium',
      models: 'IconDataOutlineMedium',
      'agent-presets': 'IconAgentPresetOutlineMedium',
      plugins: 'IconPersonalizationOutlineMedium',
      'archived-sessions': 'IconArchiveOutlineMedium',
    };
    const DEFAULT_SETTINGS_ICON = 'IconSettingsOutlineMedium';
    const ICON_TAG_ATTRS = {
      path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'],
      polyline: ['points'], polygon: ['points'],
    };
    const ICON_STYLE_ATTRS = [
      ['fill', 'fill'], ['stroke', 'stroke'], ['stroke-width', 'strokeWidth'],
      ['stroke-linecap', 'strokeLinecap'], ['stroke-linejoin', 'strokeLinejoin'], ['fill-rule', 'fillRule'],
    ];
    const IDENTITY = [1, 0, 0, 1, 0, 0];
    // An icon the phone cannot redraw from shapes is drawn here instead and sent as a small picture.
    const RASTER_PX = 64;
    const MAX_RASTER_ICONS = 12;
    const MAX_RASTER_BASE64 = 16 * 1024;
    const rasterCache = new Map();
    // A drawing that failed is tried again on later reports, a few times, before the icon is given up on.
    const MAX_RASTER_ATTEMPTS = 3;
    const rasterFailures = new Map();
    /**
     * The markup with its generated ids (React's useId gives every render a new one, so the same icon
     * would otherwise never hit the cache and the cache would fill with copies of it) renamed by order.
     */
    const stableMarkup = (markup) => {
      let text = markup;
      Array.from(new Set(Array.from(markup.matchAll(/\bid="([^"]+)"/gu), (match) => match[1])))
        .sort((a, b) => b.length - a.length)
        .forEach((id, index) => { text = text.split(id).join(`icon-id-${index}`); });
      return text;
    };
    const NAV_DEBOUNCE_MS = 500;
    const NAV_REFRESH_MS = 5 * 60 * 1000;
    const NAV_WARMUP_MS = [1500, 6000, 20000];

    const optionalRequire = (name) => { try { return require(name); } catch { return undefined; } };
    const multiply = (a, b) => [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    const paint = (value) => (value === 'none' || /^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/u.test(value)
      ? value : 'currentColor');

    /**
     * Whether the icon uses anything that shapes and paints alone cannot show: a mask or clip, a filter,
     * a gradient or pattern, a reference to other markup, text, or styling that is not an attribute. Read
     * as plain shapes, a masked icon is a solid block.
     */
    function needsRaster(svg) {
      if (svg.querySelector('mask, clipPath, filter, linearGradient, radialGradient, pattern, use, image, text, foreignObject, style, symbol')) {
        return true;
      }
      for (const element of Array.from(svg.querySelectorAll('*'))) {
        if (element.hasAttribute('mask') || element.hasAttribute('clip-path') || element.hasAttribute('filter')) return true;
        if (/url\(/u.test(`${element.getAttribute('fill') || ''} ${element.getAttribute('stroke') || ''}`)) return true;
        if (/fill|stroke|opacity|display|visibility/u.test(element.getAttribute('style') || '')) return true;
      }
      return false;
    }

    /**
     * The icon drawn by the browser itself, black on transparent, as a small PNG. The phone uses only its
     * shape and tints it like every other icon. Resolves to undefined when the browser cannot draw it.
     */
    function rasterIcon(svg, viewBox) {
      const markup = String(svg.outerHTML || '');
      if (!markup) return Promise.resolve(undefined);
      const key = stableMarkup(markup);
      const cached = rasterCache.get(key);
      if (cached) return cached;
      if (rasterCache.size >= MAX_RASTER_ICONS) return Promise.resolve(undefined);
      // Everything that needs the live DOM happens before the first await: the caller unmounts it next.
      let text;
      try {
        const copy = svg.cloneNode(true);
        copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        copy.setAttribute('viewBox', viewBox.join(' '));
        copy.setAttribute('width', String(RASTER_PX));
        copy.setAttribute('height', String(RASTER_PX));
        copy.setAttribute('style', 'color:#000');
        text = new XMLSerializer().serializeToString(copy);
      } catch { return Promise.resolve(undefined); }
      const pending = (async () => {
        const image = new Image();
        const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('icon')); });
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
        await loaded;
        const canvas = document.createElement('canvas');
        canvas.width = RASTER_PX;
        canvas.height = RASTER_PX;
        canvas.getContext('2d').drawImage(image, 0, 0, RASTER_PX, RASTER_PX);
        const url = canvas.toDataURL('image/png');
        const png = url.slice(url.indexOf(',') + 1);
        return png.length > 0 && png.length <= MAX_RASTER_BASE64
          ? { viewBox: [0, 0, RASTER_PX, RASTER_PX], nodes: [], png, width: RASTER_PX, height: RASTER_PX }
          : undefined;
      })().catch(() => undefined).then((icon) => {
        if (icon === undefined) {
          const failures = (rasterFailures.get(key) ?? 0) + 1;
          rasterFailures.set(key, failures);
          if (failures < MAX_RASTER_ATTEMPTS && rasterCache.get(key) === pending) rasterCache.delete(key);
        }
        return icon;
      });
      rasterCache.set(key, pending);
      return pending;
    }

    /** An icon as plain data (viewBox plus shapes); the phone draws it natively, no markup is sent. */
    function iconFromSvg(svg) {
      const box = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/u).map(Number);
      const viewBox = box.length === 4 && box.every(Number.isFinite) ? box
        : [0, 0, Number.parseFloat(svg.getAttribute('width')) || 16, Number.parseFloat(svg.getAttribute('height')) || 16];
      if (needsRaster(svg)) return rasterIcon(svg, viewBox);
      const styleOf = (element, base) => {
        const style = { ...base };
        for (const [attribute, key] of ICON_STYLE_ATTRS) {
          const value = element.getAttribute(attribute);
          if (value === null || value === '') continue;
          style[key] = key === 'strokeWidth' ? Number.parseFloat(value) : value;
        }
        return style;
      };
      const nodes = [];
      const visit = (element, inherited, matrix) => {
        for (const child of Array.from(element.children || [])) {
          const tag = String(child.tagName || '').toLowerCase();
          const style = styleOf(child, inherited);
          const list = child.transform?.baseVal;
          const own = list && list.numberOfItems > 0 ? list.consolidate()?.matrix : undefined;
          const next = own ? multiply(matrix, [own.a, own.b, own.c, own.d, own.e, own.f]) : matrix;
          if (tag === 'g') { visit(child, style, next); continue; }
          const names = ICON_TAG_ATTRS[tag];
          if (!names) continue;
          const node = { tag };
          for (const name of names) {
            const value = child.getAttribute(name);
            if (value === null) continue;
            node[name] = name === 'd' || name === 'points' ? value : Number.parseFloat(value);
          }
          node.fill = paint(style.fill ?? 'currentColor');
          node.stroke = paint(style.stroke ?? 'none');
          if (Number.isFinite(style.strokeWidth)) node.strokeWidth = style.strokeWidth;
          if (style.strokeLinecap) node.strokeLinecap = style.strokeLinecap;
          if (style.strokeLinejoin) node.strokeLinejoin = style.strokeLinejoin;
          if (style.fillRule) node.fillRule = style.fillRule;
          if (next.some((value, index) => value !== IDENTITY[index])) node.matrix = next;
          nodes.push(node);
        }
      };
      // The root carries the defaults (fill="none", stroke-width) its shapes inherit.
      visit(svg, styleOf(svg, {}), IDENTITY);
      return nodes.length ? { viewBox, nodes } : undefined;
    }

    /** Render a DSH icon component off screen, so hooks, memo and forwardRef behave as they do in DSH. */
    function renderIcon(Component, props) {
      if (typeof Component !== 'function' && (typeof Component !== 'object' || Component === null)) return undefined;
      const client = optionalRequire('react-dom/client');
      const dom = optionalRequire('react-dom');
      if (!client?.createRoot || !dom?.flushSync) return undefined;
      const container = document.createElement('div');
      const root = client.createRoot(container);
      try {
        dom.flushSync(() => root.render(h(Component, props)));
        const svg = container.querySelector('svg');
        return svg ? iconFromSvg(svg) : undefined;
      } catch { return undefined; } finally {
        try { root.unmount(); } catch { /* The container is discarded either way. */ }
      }
    }

    function startNavigationPublisher(ctx) {
      if (typeof setTimeout !== 'function') return undefined;
      const slotsModule = optionalRequire('@deepseek-ai/dsh-client-ui-slots');
      const primitives = optionalRequire('@deepseek-ai/dsh-client-ui-primitives');
      const label = (options, fallback) => {
        try {
          const resolved = slotsModule?.resolveSlotLabel?.(options?.label);
          if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
        } catch { /* Fall through to the plain forms. */ }
        const value = options?.label;
        if (typeof value === 'function') {
          try { const text = value(); if (typeof text === 'string' && text.trim()) return text.trim(); } catch { /* ignore */ }
        }
        return typeof value === 'string' && value.trim() ? value.trim() : fallback;
      };
      const entriesOf = (name) => { const list = ctx.slots?.entries?.(name); return Array.isArray(list) ? list : undefined; };
      const source = (entry) => (typeof entry?.registrant === 'string' ? entry.registrant : undefined);

      // Each collector returns undefined when its registry cannot be read, so the host keeps what it had.
      const collectSidebar = () => {
        const entries = ctx.slots?.entriesOfSlot?.('sidebar.panellist');
        if (!Array.isArray(entries)) return undefined;
        return entries.filter((entry) => entry?.options?.id !== undefined).map((entry) => ({
          id: String(entry.options.id),
          title: label(entry.options, String(entry.options.id)),
          order: entry.options.order ?? 0,
          source: source(entry),
          icon: renderIcon(entry.component, { size: 20, active: false }),
        }));
      };
      const collectViews = () => {
        const entries = entriesOf('conversation.view');
        if (!entries) return undefined;
        // DSH hides the Trajectory tab unless developer tools are on.
        let developer = true;
        try { developer = ctx.configForms?.developerTools?.enabled?.getSnapshot?.() !== false; } catch { /* keep */ }
        return entries
          .filter((entry) => entry?.options?.id !== undefined && (developer || entry.options.id !== 'trajectory'))
          .map((entry) => ({
            id: String(entry.options.id),
            title: label(entry.options, String(entry.options.id)),
            order: entry.options.order ?? 0,
            source: source(entry),
          }));
      };
      const collectSettings = () => {
        const entries = entriesOf('settings.section');
        if (!entries) return undefined;
        return entries.filter((entry) => entry?.options?.id !== undefined).map((entry) => {
          const id = String(entry.options.id);
          return {
            id, title: label(entry.options, id), order: entry.options.order ?? 0, source: source(entry),
            icon: renderIcon(primitives?.[SETTINGS_ICONS[id] ?? DEFAULT_SETTINGS_ICON], { size: 20 }),
          };
        });
      };
      const collect = () => {
        const snapshot = { schemaVersion: 1 };
        for (const [name, read] of [
          ['sidebar', collectSidebar], ['views', collectViews], ['settings', collectSettings],
        ]) {
          try { const list = read(); if (list) snapshot[name] = list; } catch { /* leave the list out */ }
        }
        return snapshot;
      };

      let disposed = false;
      let timer;
      let lastSignature = '';
      // An icon drawn by the browser arrives a moment later than the shapes of the others.
      const settleIcons = async (snapshot) => {
        const items = ['sidebar', 'settings'].flatMap((name) => snapshot[name] ?? []);
        await Promise.all(items.map(async (item) => {
          const icon = await item.icon;
          if (icon === undefined) delete item.icon; else item.icon = icon;
        }));
      };
      const publish = async () => {
        timer = undefined;
        if (disposed) return;
        const snapshot = collect();
        await settleIcons(snapshot);
        if (disposed) return;
        const signature = JSON.stringify(snapshot);
        if (signature === lastSignature || Object.keys(snapshot).length < 2) return;
        try {
          await request('nav', snapshot);
          lastSignature = signature;
        } catch { /* The next change or refresh retries; the phone keeps the last snapshot meanwhile. */ }
      };
      const schedule = () => {
        if (disposed) return;
        clearTimeout(timer);
        timer = setTimeout(publish, NAV_DEBOUNCE_MS);
      };

      const unsubscribers = [];
      const subscribed = new Set();
      const subscribe = (key, attach) => {
        if (subscribed.has(key)) return;
        try {
          const dispose = attach();
          if (typeof dispose === 'function') { unsubscribers.push(dispose); subscribed.add(key); }
        } catch { /* The service is not there (yet); the periodic refresh tries again. */ }
      };
      const watch = () => {
        for (const name of ['sidebar.panellist', 'conversation.view', 'settings.section']) {
          subscribe(name, () => ctx.slots.subscribe(name, schedule));
        }
        subscribe('locale', () => ctx.locale.subscribe(schedule));
        subscribe('developerTools', () => ctx.configForms.developerTools.enabled.subscribe(schedule));
      };

      // Plugins register as DSH loads them, so look again a few times while it settles, then rarely.
      const timers = NAV_WARMUP_MS.map((delay) => setTimeout(() => { watch(); schedule(); }, delay));
      const interval = setInterval(() => { watch(); schedule(); }, NAV_REFRESH_MS);
      watch();
      schedule();
      return () => {
        disposed = true;
        clearTimeout(timer);
        timers.forEach((handle) => clearTimeout(handle));
        clearInterval(interval);
        unsubscribers.forEach((dispose) => { try { dispose(); } catch { /* already gone */ } });
      };
    }

    // ---- Providers: the harnesses installed on this computer -------------------------------------------
    //
    // A harness the plugin found (Claude Code, Codex) is a model route of DSH. Two pieces of DSH's own interface
    // learn about it, both through the public client APIs and without editing any DSH package:
    //
    //  1. Scoping. `modelDirectories.directoryFor(sessionId)` returns the per-session ModelDirectory whose store
    //     feeds both the composer's model seat and the `/model` popup. Wrapping that store's `set` so `groups`
    //     only holds the groups of the session's current provider scopes both at once, with DSH's own menu,
    //     search, effort row and keyboard handling untouched.
    //  2. The chip. `conversation.hero.agentPreset` is a `single` slot rendered last in the new-session screen's
    //     chip row and occupied by the mode chip. A single slot renders its lowest-priority entry, so an entry
    //     at priority -1 shadows it; it declares a child slot and re-hosts a clone of the original entry there,
    //     so the mode chip keeps working and the provider chip is rendered beside it.
    //
    // The provider is chosen by selecting that provider's default model through the directory's own `select()`,
    // which is `session.selectModel` and so a `model/selection` event in the session's log.

    const PROVIDERS = 'dudu-providers';
    const HERO_SLOT = 'conversation.hero.agentPreset';
    const MODE_SLOT = 'dudu.hero.mode';
    // Routes that are whole harnesses. Every other route belongs to the DeepSeek family (DeepSeek Account,
    // DeepSeek, and any API-key provider the user configured).
    const HARNESS = new Set(['claude', 'codex']);
    const familyOf = (provider) => (HARNESS.has(provider) ? provider : 'deepseek');

    // The look of the mode chip (dsh-client-ui-agent-preset), under this plugin's own class names.
    const providerStyles = `
.dudu-menuAnchor{min-width:54px;max-width:100%}
.dudu-seat{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(100%,240px);min-height:28px;color:var(--dsw-alias-label-primary);white-space:nowrap;cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
.dudu-seat:not(:disabled):hover,.dudu-seat[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dudu-seat:disabled{cursor:default;color:var(--dsw-alias-label-quaternary)}
.dudu-seatIcon{color:var(--dsw-alias-label-primary);flex:none}
.dudu-seatLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.dudu-chevron{color:var(--dsw-alias-label-caption);flex:none}
.dudu-itemName{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
`;

    const noopSubscribe = () => () => {};
    const emptyState = { current: null, groups: [], status: 'idle', pending: null };

    function scopeState(state) {
      const selection = state?.current;
      if (!selection || !Array.isArray(state.groups)) return state;
      const family = familyOf(selection.provider);
      const groups = state.groups.filter((group) => familyOf(group.id) === family);
      return groups.length === state.groups.length ? state : { ...state, groups };
    }

    function installScoping(service) {
      const wrapped = new Map();
      const scope = (directory) => {
        if (!wrapped.has(directory)) {
          const store = directory.store;
          const originalSet = store.set;
          wrapped.set(directory, originalSet);
          store.set = (next) => originalSet(scopeState(next));
          directory.syncInputs(); // publish the current state again, through the wrapper
        }
        return directory;
      };
      const original = service.directoryFor;
      service.directoryFor = function directoryFor(sessionId) { return scope(original.call(this, sessionId)); };
      try { for (const directory of service.live.directories.values) scope(directory); } catch { /* none yet */ }
      return () => {
        delete service.directoryFor;
        for (const [directory, originalSet] of wrapped) {
          directory.store.set = originalSet;
          try { directory.syncInputs(); } catch { /* the directory is already gone */ }
        }
        wrapped.clear();
      };
    }

    // The directory exists once the session has a scope and a binding; before that `directoryFor` throws. The lookup
    // is cheap and idempotent (the service caches), so it is repeated on every render, and while it fails a short
    // timer forces another render instead of caching the failure.
    function useDirectory(service, sessionId) {
      const [attempt, retry] = useState(0);
      let directory;
      if (sessionId !== undefined) {
        try { directory = service.directoryFor(sessionId); } catch { directory = undefined; }
      }
      useEffect(() => {
        if (directory !== undefined || sessionId === undefined) return undefined;
        const timer = setTimeout(() => retry((value) => value + 1), 250);
        return () => clearTimeout(timer);
      }, [directory, sessionId, attempt]);
      const state = useSyncExternalStore(
        directory ? directory.store.subscribe : noopSubscribe,
        directory ? directory.store.getSnapshot : () => emptyState,
      );
      return { directory, state };
    }

    // What the chip offers, from the Host's catalog: the DeepSeek family as one entry (when any of its groups has
    // models) and one entry per harness that is registered and has models.
    function providersOf(catalog) {
      const groups = catalog?.value?.groups ?? [];
      const result = [];
      const deepseek = groups.filter((group) => !HARNESS.has(group.id));
      if (deepseek.length > 0) result.push({ id: 'deepseek', name: 'DeepSeek', groups: deepseek });
      for (const group of groups) if (HARNESS.has(group.id)) result.push({ id: group.id, name: group.name, groups: [group] });
      return result;
    }

    const groupRank = (group) => (group.id === 'deepseek-account' ? 0 : group.id === 'deepseek-official' ? 1 : 2);

    // The provider's default model: the deployment's default when it belongs to the provider, else the first model of
    // its first group (DSH's own provider order), with that model's default reasoning effort.
    function defaultSelection(provider, catalog) {
      const fallback = catalog?.value?.default;
      const groups = [...provider.groups].sort((a, b) => groupRank(a) - groupRank(b));
      if (fallback && familyOf(fallback.provider) === provider.id
        && groups.some((group) => group.id === fallback.provider && group.models.some((model) => model.id === fallback.model))) {
        return fallback;
      }
      const model = groups[0].models[0];
      return { provider: groups[0].id, model: model.id, ...(model.reasoning?.defaultEffort ? { reasoningEffort: model.reasoning.defaultEffort } : {}) };
    }

    function providerChip({ Menu, IconChevronDownOutlineRegular, IconCordisPluginOutlineRegular }, service) {
      return function ProviderChip({ sessionId }) {
        const { directory, state } = useDirectory(service, sessionId);
        const catalog = useSyncExternalStore(service.catalog.store.subscribe, service.catalog.store.getSnapshot);
        const [open, setOpen] = useState(false);
        const [error, setError] = useState('');
        const providers = useMemo(() => providersOf(catalog), [catalog]);
        useEffect(() => { directory?.load().catch(() => {}); }, [directory]);
        // With one provider there is nothing to choose: render nothing and leave DSH's own row as it is.
        if (!directory || providers.length < 2 || !state.current) return null;
        const family = familyOf(state.current.provider);
        const current = providers.find((provider) => provider.id === family) ?? providers[0];
        const pick = async (id) => {
          setOpen(false);
          const next = providers.find((provider) => provider.id === id);
          if (!next || next.id === family) return;
          setError('');
          const result = await directory.select(defaultSelection(next, catalog));
          if (!result.ok) setError(`${result.error.code}: ${result.error.message}`);
        };
        return h(Menu, {
          open,
          onClose: () => setOpen(false),
          items: providers.map((provider) => ({ id: provider.id, label: h('span', { className: 'dudu-itemName' }, provider.name) })),
          selectedId: current.id,
          onSelect: pick,
          align: 'start',
          portal: true,
          className: 'dudu-menuAnchor',
          anchor: h('button', {
            type: 'button',
            className: 'dudu-seat',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-label': `供应商，当前 ${current.name}`,
            title: error || undefined,
            'data-testid': 'dudu-provider-chip',
            disabled: state.status === 'selecting',
            onClick: () => setOpen((value) => !value),
          },
          h(IconCordisPluginOutlineRegular, { className: 'dudu-seatIcon' }),
          h('span', { className: 'dudu-seatLabel' }, current.name),
          h(IconChevronDownOutlineRegular, { className: 'dudu-chevron' })),
        });
      };
    }

    // The entry that shadows the hero's mode chip: the original chip (only for the DeepSeek family) and the provider chip.
    function installHeroChip(ctx, service, ProviderChip) {
      function Hero(props) {
        const { state } = useDirectory(service, props.sessionId);
        const family = state.current ? familyOf(state.current.provider) : 'deepseek';
        return h(Fragment, null,
          family === 'deepseek' ? props.renderSlot(MODE_SLOT, {}) : null,
          h(ProviderChip, { sessionId: props.sessionId }));
      }
      let cloneOf;
      let disposeClone = () => {};
      const sync = () => {
        const original = ctx.slots.entries(HERO_SLOT).find((entry) => entry.registrant !== PROVIDERS);
        if (original === cloneOf) return;
        disposeClone();
        disposeClone = () => {};
        cloneOf = original;
        if (!original) return;
        disposeClone = ctx.slots.register({
          name: MODE_SLOT,
          ...(original.inject ? { inject: original.inject } : {}),
          ...(original.locale ? { locale: original.locale } : {}),
          registrant: `${PROVIDERS}:mode`,
        }, original.component);
      };
      return ctx.slots.inject(HERO_SLOT, () => {
        const disposeHero = ctx.slots.register({
          name: HERO_SLOT,
          priority: -1,
          children: { [MODE_SLOT]: { kind: 'single', scope: 'session-maybe' } },
          registrant: PROVIDERS,
        }, Hero);
        const unsubscribe = ctx.slots.subscribe(HERO_SLOT, sync);
        sync();
        return () => {
          unsubscribe();
          disposeClone();
          cloneOf = undefined;
          disposeHero();
        };
      });
    }

    // What the settings page says about a harness the plugin looked for.
    const PROVIDER_STATES = { ready: '可用', missing: '未找到', unsupported: '版本不受支持', broken: '无法运行' };

    function ProvidersSettings() {
      const [providers, setProviders] = useState(null);
      const [paths, setPaths] = useState({});
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [saved, setSaved] = useState('');
      const show = (value) => {
        setProviders(value.providers);
        setPaths(Object.fromEntries(value.providers.map((provider) => [provider.id, provider.configuredPath])));
      };
      useEffect(() => {
        let alive = true;
        request('providers/state').then((value) => { if (alive) show(value); }, (failure) => { if (alive) setError(failure.message); });
        return () => { alive = false; };
      }, []);
      const run = async (action, body, done = '') => {
        setBusy(true); setError(''); setSaved('');
        try { show(await request(`providers/${action}`, body)); setSaved(done); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
      };
      if (!providers) return h('div', { className: 'dsbot-settings' }, error || '正在读取…');
      const button = (props, label) => h(Button, { ...props, size: 'sm', className: 'dsbot-button' }, label);
      return h('div', { className: 'dsbot-settings' },
        h('h2', null, '供应商'),
        providers.map((provider) => h('section', { className: 'dsbot-settings-section', key: provider.id },
          h('h3', null, provider.name),
          h('div', { className: 'dsbot-settings-row' },
            h('span', { className: 'dsbot-field-title' }, '状态'),
            h('div', null,
              h('div', null, [PROVIDER_STATES[provider.state] ?? provider.state, provider.version].filter(Boolean).join(' ')),
              provider.path && h('div', { className: 'dsbot-muted' }, provider.path),
              (provider.state === 'unsupported' || provider.state === 'broken') && provider.reason && h('div', { className: 'dsbot-muted' }, provider.reason))),
          h('div', { className: 'dsbot-settings-row' },
            h('label', { className: 'dsbot-field-title', htmlFor: `dudu-provider-enabled-${provider.id}` }, '启用'),
            h('input', {
              id: `dudu-provider-enabled-${provider.id}`, type: 'checkbox', className: 'dudu-checkbox', checked: provider.enabled, disabled: busy,
              onChange: (event) => run('save', { id: provider.id, enabled: event.target.checked }),
            })),
          h('div', { className: 'dsbot-settings-row' },
            h('label', { className: 'dsbot-field-title', htmlFor: `dudu-provider-path-${provider.id}` }, '可执行文件路径'),
            h('div', { className: 'dsbot-address-field' },
              h(Input, {
                id: `dudu-provider-path-${provider.id}`, type: 'text', className: 'dsbot-input', value: paths[provider.id] ?? '',
                placeholder: '留空则自动查找', autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, disabled: busy,
                onChange: (event) => { setPaths((previous) => ({ ...previous, [provider.id]: event.target.value })); setSaved(''); },
              }),
              button({
                type: 'button', variant: 'primary', disabled: busy || (paths[provider.id] ?? '') === provider.configuredPath,
                onClick: () => run('save', { id: provider.id, path: paths[provider.id] ?? '' }, '已保存'),
              }, '保存'))))),
        h('div', { className: 'dsbot-actions' },
          button({ type: 'button', variant: 'outline', disabled: busy, onClick: () => run('refresh', {}) }, busy ? '处理中…' : '重新检测'),
          saved && h('span', { className: 'dsbot-muted', role: 'status' }, saved)),
        error && h('p', { className: 'dsbot-error', role: 'alert' }, error));
    }

    // The chip and the scoping need services only some DSH builds have, so they are a plugin of their own that waits
    // for them; the settings page and the phone navigation never depend on it. The caller of the model directory's
    // methods has to declare the injects the service itself declares (Cordis' strict injection).
    const providerUi = {
      name: PROVIDERS,
      inject: ['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'],
      apply(ctx) {
        const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = providerStyles;
          document.head.appendChild(style);
          return () => style.remove();
        });
        ctx.effect(() => installScoping(ctx.modelDirectories));
        ctx.effect(() => installHeroChip(ctx, ctx.modelDirectories, providerChip(primitives, ctx.modelDirectories)));
      },
    };

    return {
      name: 'dudu',
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = styles;
          document.head.appendChild(style);
          return () => style.remove();
        });
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config', key: 'dudu',
        }, (props = {}) => props.view === 'summary' ? null : h(Settings)));
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dudu-mobile-control',
          order: 50,
          label: () => '手机控制',
        }, Settings));
        // Phone pages run this same module inside their own frontend; only DSH's own window reports.
        if (!window.__DSBOT_PAGE__) {
          ctx.effect(() => {
            try { return startNavigationPublisher(ctx); } catch { return undefined; }
          });
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'dudu-providers',
            order: 51,
            label: () => '供应商',
          }, ProvidersSettings));
          ctx.plugin(providerUi);
        }
      },
    };
  },
});
