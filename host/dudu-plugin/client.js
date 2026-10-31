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

    // ---- The 嘟嘟 panel: the sessions the harnesses on this computer already have ------------------------------------
    //
    // A global panel of DSH's sidebar, added the way DSH's own plugins add theirs (a `sidebar.panellist` entry that
    // selects a panel, and a `main` page keyed by the same id). It lists the Claude Code and Codex sessions the plugin
    // finds on this computer, searchable, and loads one into DSH: the host writes a session that holds the
    // conversation and resumes the harness's own session, and this page then opens it.

    const PANEL_ID = 'dudu';
    // The Dudu logo, transparent behind it, as DSH's sidebar draws its icons.
    const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAP1BMVEUudvI3bug3cOtiYv8AAP84ce0ycbtUqP9VVao/P78Af38zmf8AAAA5dPAA//8zaNoAAAAAAAAAAAAAAAAAAAD5D19zAAAAEHRSTlMSZJ8CAdEEAwMEAgUA/AEUQQBTPQAAAuJJREFUeNrtmt2WqyAMhTeQQNuD8P5vexDbOWP50UK8Oau5mDV1aT53QAgB+IsNX8DqAy54b/LfCwAw//53JA9I7qE0M2utkH+KAggeevkxjYIwByDjf7lPxgUBov6TKX+TAxivlsJAkAIYj9L/ovdBmgG4MkBZwo4wAQhVAasEyABMA8CeZACoNfFq8TfhGkC4FoCrAfEL+LbB/xwiSnYNgGDh8JzFABNEQ/Swr/H9bu39OVQDUgqMyamV0nrNTZ7pyfoUOSMAyN5T2lNMKmsONB+i1b3SdS8LK/CcgmC8VQ0fXTsJSK8/5P5siKyPehmzMwrItVpQRgGZCf8nFNRyTkkAuSn/xwDM+T8EYCb+JxrZzPo/ACBg0v9BiMxkAxwpmA9QXwEhTvvvKrACAnoKiM4IUEqNKjjzCXBMN0YeUxBQmRz1+/vFW/QYApSrLi6m3m2JZ3uduQ0oB6GUnCDurqqA/DmqoTa4c2VFegP2yHTjrRejpoIyQiq4vCDm96fRAzQVlH1oW5DuIve6NKKgaAKuXN+eHg2RrhYFdsq2SgRIjfSiB78r2NJo0r/rQWjXQfoA8rH8aOldGVs8vKWRD+1RABasnf5tgFJ+vagHAJWeofyfsnMpuysETgHSvTEWIxvz2HxQA6xjEbTQfBB8bTLQWmxGI295kbDOfHAxQCBjORqL1NUKLgaQB1/byEKN0JuTlQygVTclL5A4LnxvF2adRIy4U7vuTrVnrVscl5CgUlrWBCBE2U5ULEDcdEc62gExxLPLjz4AhEkBR7tQkyPS2yaU+EJcndmomyDoXRdtVluGCakH0am9TIwN3BX/rYrXUEFNVfw3a3aflwR19O6THfEPi5q6tll9UDfNe92nEJzdh48PDdAqGZqPvOetdjN0KoHyKYBa8frpe6the4vxYw8GuWdEpAqF/rH0A8DrWAJNnquAtQ0XNxgIHdwgGJve2TljHFazBuF7tkUE8Bfa9K2SazMwbgAAAABJRU5ErkJggg==';
    const AGENTS = [{ id: 'all', name: '全部' }, { id: 'claude', name: 'Claude' }, { id: 'codex', name: 'ChatGPT' }];
    const RECENT = 8;   // sessions on the overview itself
    const MORE = 200;   // when "全部" is opened
    const FOUND = 50;   // answers to a search

    const panelStyles = `
.dudu-page{height:100%;overflow:auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.dudu-page *{box-sizing:border-box}
.dudu-wrap{max-width:1000px;margin:0 auto;padding:18px 28px 40px}
.dudu-bar{display:flex;align-items:center;gap:8px;margin:0 0 16px}.dudu-search{flex:1 1 auto;min-width:0}
.dudu-tabs{display:flex;gap:2px;flex:none}
.dudu-tab{height:28px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.dudu-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}.dudu-tab[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:500}
.dudu-phone{display:inline-flex;align-items:center;gap:6px;flex:none;padding:0 4px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dudu-index{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}
.dudu-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-quaternary,#b8b8b8);flex:none}
.dudu-dot--on,.dudu-dot--done{background:#2fb344}.dudu-dot--busy{background:#4176e6;animation:dudu-pulse 1.4s ease-in-out infinite}
@keyframes dudu-pulse{50%{opacity:.35}}
.dudu-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;margin:0 0 20px}
.dudu-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.dudu-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:12px 14px;min-width:0}
.dudu-label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dudu-name{display:flex;align-items:baseline;gap:8px;margin:6px 0 2px;font-weight:500}.dudu-name:first-of-type{margin-top:0}
.dudu-warn{color:var(--dsw-alias-state-error-primary);font-weight:400;font-size:12px}
.dudu-limit{display:grid;grid-template-columns:52px minmax(0,1fr) 36px 78px;align-items:center;gap:8px;padding:2px 0;font-variant-numeric:tabular-nums}
.dudu-limit span:last-child{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:right;white-space:nowrap}.dudu-limit span:nth-child(3){text-align:right}
.dudu-meter{height:6px;border-radius:3px;background:var(--dsw-alias-border-l2);overflow:hidden}
.dudu-meter i{display:block;height:100%;border-radius:3px;background:#4176e6}.dudu-meter i.warn{background:#e8a317}.dudu-meter i.hot{background:#e5484d}
.dudu-run{display:flex;align-items:center;gap:8px;padding:3px 0;min-width:0}
.dudu-run b{flex:1 1 auto;min-width:0;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dudu-run em{flex:0 1 38%;min-width:0;font-style:normal;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.dudu-run span{flex:none;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.dudu-run--open{cursor:pointer}.dudu-run--open:hover b{text-decoration:underline}
.dudu-fold{display:flex;align-items:center;gap:8px;margin:2px 0 0;padding:3px 0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.dudu-fold:hover{color:var(--dsw-alias-label-primary)}
.dudu-idle{max-height:180px;overflow:auto;margin-top:2px}
.dudu-none{color:var(--dsw-alias-label-secondary)}
.dudu-section{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:12px}
.dudu-list{border-top:.5px solid var(--dsw-alias-border-l2)}
.dudu-row{padding:7px 8px;border-bottom:.5px solid var(--dsw-alias-border-l2);cursor:pointer}.dudu-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dudu-main{display:flex;align-items:center;gap:10px;min-width:0}
.dudu-title{flex:1 1 auto;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dudu-meta{flex:0 1 auto;display:flex;align-items:center;gap:8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.dudu-meta span:first-child{max-width:200px;overflow:hidden;text-overflow:ellipsis}
.dudu-badge{display:inline-block;flex:none;padding:0 7px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.dudu-preview{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.dudu-more{margin-top:8px;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.dudu-more code{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;color:var(--dsw-alias-label-primary)}.dudu-more .dudu-actions{display:flex;gap:8px;margin-top:6px}
.dudu-note{padding:22px 10px;color:var(--dsw-alias-label-secondary);text-align:center}.dudu-fail{margin-top:4px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dudu-count{margin:8px 2px 0;color:var(--dsw-alias-label-secondary);font-size:12px}
.dudu-mark{background:color-mix(in srgb,#ffb800 38%,transparent);color:inherit;border-radius:2px}
@media(max-width:760px){.dudu-wrap{padding:14px 14px 32px}.dudu-grid{grid-template-columns:minmax(0,1fr)}.dudu-bar{flex-wrap:wrap}.dudu-meta span:first-child{max-width:110px}}
`;

    const ago = (time) => {
      const seconds = Math.max(0, (Date.now() - time) / 1000);
      if (seconds < 60) return '刚刚';
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
      if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
      return new Date(time).toLocaleDateString('zh-CN');
    };
    // How long, without "ago": 12 分钟, 3 小时, 2 天.
    const span = (time) => {
      const seconds = Math.max(0, (Date.now() - time) / 1000);
      if (seconds < 60) return '';
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
      return `${Math.floor(seconds / 86400)} 天`;
    };
    const clock = (time) => new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    // When a window starts over: the time of day when that is today, else the weekday too.
    const resetText = (time) => {
      if (!Number.isFinite(time)) return '';
      const date = new Date(time);
      const sameDay = date.toDateString() === new Date().toDateString();
      return sameDay ? `${clock(time)} 重置` : `${date.toLocaleDateString('zh-CN', { weekday: 'short' })} ${clock(time)}`;
    };
    const shortPath = (path, home) => {
      if (!path) return '';
      const text = home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
      const parts = text.split('/');
      return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : text;
    };
    const quote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
    const resumeCommand = (session) => `${session.cwd ? `cd ${quote(session.cwd)} && ` : ''}${session.provider === 'claude' ? 'claude --resume' : 'codex resume'} ${session.id}`;
    const agentName = (provider) => (provider === 'claude' ? 'Claude' : 'ChatGPT');
    const termsOf = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);
    // A lone letter would light up half the words of a snippet.
    const markable = (terms) => terms.filter((term) => term.length > 1 || /[^\x00-\x7f]/.test(term));
    // The text with the words of the query marked.
    const highlight = (text, terms) => {
      terms = markable(terms);
      if (!terms.length) return text;
      const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      return text.split(pattern).map((part, index) => (index % 2 ? h('mark', { key: index, className: 'dudu-mark' }, part) : part));
    };

    function DuduGlyph({ size = 18 }) {
      return h('img', { src: LOGO, width: size, height: size, alt: '', 'aria-hidden': 'true', draggable: false, style: { display: 'block' } });
    }

    // Reads something now and again after the time `delay` says (a number, or a function of the last reading); keeps the last
    // reading when one fails.
    function usePoll(read, delay) {
      const [value, setValue] = useState(null);
      useEffect(() => {
        let alive = true;
        let timer;
        const tick = async () => {
          let next = typeof delay === 'function' ? delay(null) : delay;
          try {
            const result = await read();
            if (alive) setValue(result);
            if (typeof delay === 'function') next = delay(result);
          } catch { /* the last reading stays */ }
          if (alive) timer = setTimeout(tick, next);
        };
        tick();
        return () => { alive = false; clearTimeout(timer); };
      }, []);
      return value;
    }

    function Meter({ used }) {
      const level = used >= 0.9 ? 'hot' : used >= 0.7 ? 'warn' : '';
      return h('div', { className: 'dudu-meter', role: 'meter', 'aria-valuenow': Math.round(used * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('i', { className: level, style: { width: `${Math.max(1, Math.round(used * 100))}%` } }));
    }

    function UsageCard({ usage }) {
      const shown = (usage?.providers ?? []).filter((provider) => provider.state !== 'hidden');
      if (usage && !shown.length) return null;
      return h('div', { className: 'dudu-card', 'data-testid': 'dudu-usage' },
        h('div', { className: 'dudu-label' }, '用量'),
        !usage && h('div', { className: 'dudu-none' }, '…'),
        shown.map((provider) => h(Fragment, { key: provider.id },
          h('div', { className: 'dudu-name' }, provider.name,
            provider.limited && h('span', { className: 'dudu-warn' }, '已限流'),
            provider.state === 'login' && h('span', { className: 'dudu-none' }, '需要登录'),
            provider.state === 'unavailable' && h('span', { className: 'dudu-none' }, '无法读取')),
          provider.windows.map((window) => h('div', { className: 'dudu-limit', key: window.key },
            h('span', null, window.label),
            h(Meter, { used: window.used }),
            h('span', null, `${Math.round(window.used * 100)}%`),
            h('span', null, resetText(window.resetsAt)))))));
    }

    function RunningRow({ item, kind, home, onOpen }) {
      const state = kind === 'busy' ? `忙${span(item.since) ? ` ${span(item.since)}` : ''}` : kind === 'done' ? `${ago(item.since)}完成` : `空闲${span(item.since) ? ` ${span(item.since)}` : ''}`;
      const open = item.dshSessionId ? () => onOpen(item.dshSessionId) : undefined;
      return h('div', { className: `dudu-run${open ? ' dudu-run--open' : ''}`, 'data-testid': 'dudu-running', 'data-state': kind, onClick: open },
        h('i', { className: `dudu-dot dudu-dot--${kind === 'busy' ? 'busy' : kind === 'done' ? 'done' : ''}` }),
        h('b', { title: item.title }, item.title || agentName(item.provider)),
        h('em', { title: item.cwd ?? '' }, shortPath(item.cwd, home)),
        h('span', null, state));
    }

    function RunningCard({ running, home, onOpen }) {
      const [unfolded, setUnfolded] = useState(false);
      const lead = running ? [...running.busy, ...running.done].slice(0, 8) : [];
      const left = running ? running.idle.length + (running.busy.length + running.done.length - lead.length) : 0;
      return h('div', { className: 'dudu-card', 'data-testid': 'dudu-runningcard' },
        h('div', { className: 'dudu-label' }, '正在运行', running && running.busy.length > 0 && h('span', null, `${running.busy.length} 忙`)),
        !running && h('div', { className: 'dudu-none' }, '…'),
        running && lead.length === 0 && left === 0 && h('div', { className: 'dudu-none' }, '没有在运行的会话'),
        lead.map((item) => h(RunningRow, { key: `${item.provider}:${item.id}`, item, kind: item.status, home, onOpen })),
        left > 0 && h('button', { type: 'button', className: 'dudu-fold', onClick: () => setUnfolded(!unfolded), 'aria-expanded': unfolded },
          `另有 ${left} 个空闲`, h('span', null, unfolded ? '收起' : '展开')),
        unfolded && h('div', { className: 'dudu-idle' }, running.idle.map((item) => h(RunningRow, { key: `${item.provider}:${item.id}`, item, kind: 'idle', home, onOpen }))));
    }

    function SessionRow({ session, home, terms, expanded, busy, failure, onToggle, onOpen }) {
      const [copied, setCopied] = useState(false);
      const copy = async (event) => {
        event.stopPropagation();
        try { await navigator.clipboard.writeText(resumeCommand(session)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the page may not be allowed to copy */ }
      };
      return h('div', { className: 'dudu-row', 'data-testid': 'dudu-session', 'data-key': session.key, onClick: onToggle },
        h('div', { className: 'dudu-main' },
          h('span', { className: 'dudu-badge' }, agentName(session.provider)),
          h('div', { className: 'dudu-title', title: session.title }, highlight(session.title, terms)),
          h('div', { className: 'dudu-meta' },
            session.cwd && h('span', { title: session.cwd }, shortPath(session.cwd, home)),
            h('span', null, ago(session.updatedAt)),
            h(Button, {
              size: 'sm', variant: session.dshSessionId ? 'outline' : 'primary', className: 'dsbot-button', disabled: busy,
              onClick: (event) => { event.stopPropagation(); onOpen(); },
            }, busy ? '加载中…' : session.dshSessionId ? '打开' : '加载到 DSH'))),
        session.evidence && h('div', { className: 'dudu-preview' }, highlight(session.evidence.text, terms)),
        failure && h('div', { className: 'dudu-fail', role: 'alert' }, failure),
        expanded && h('div', { className: 'dudu-more' },
          session.preview && h('div', null, highlight(session.preview, terms)),
          session.cwd && h('div', null, '目录：', h('code', null, session.cwd)),
          h('div', null, '会话 ID：', h('code', null, session.id)),
          h('div', { className: 'dudu-actions' },
            h(Button, { size: 'sm', variant: 'outline', className: 'dsbot-button', onClick: copy }, copied ? '已复制' : '复制恢复命令'))));
    }

    function DuduPage({ openSession }) {
      const [query, setQuery] = useState('');
      const [agent, setAgent] = useState('all');
      const [showAll, setShowAll] = useState(false);
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [expanded, setExpanded] = useState('');
      const [busy, setBusy] = useState('');
      const [failure, setFailure] = useState({});
      const latest = useRef(0);
      const searching = query.trim() !== '' || agent !== 'all';
      const limit = searching ? FOUND : showAll ? MORE : RECENT;
      const usage = usePoll(() => request('overview/usage'), 120_000);
      const running = usePoll(() => request('overview/running'), 5_000);
      const phone = usePoll(() => request('state'), 30_000);
      const fetchList = (refresh = false) => {
        const ticket = ++latest.current;
        return request('sessions/list', { query: query.trim(), ...(agent === 'all' ? {} : { provider: agent }), limit, refresh })
          .then((value) => { if (ticket === latest.current) { setData(value); setError(''); } },
            (problem) => { if (ticket === latest.current) setError(problem.message); });
      };
      useEffect(() => {
        const timer = setTimeout(() => { fetchList(); }, data ? 180 : 0);
        return () => clearTimeout(timer);
      }, [query, agent, showAll]);
      // While the conversations are still being read for the search, look again until they are.
      useEffect(() => {
        if (!data?.indexing?.running) return undefined;
        const timer = setTimeout(() => { void fetchList(); }, 2000);
        return () => clearTimeout(timer);
      }, [data]);
      const open = async (session) => {
        setBusy(session.key);
        setFailure((previous) => ({ ...previous, [session.key]: '' }));
        try {
          const result = session.dshSessionId ? { sessionId: session.dshSessionId } : await request('sessions/load', { provider: session.provider, id: session.id });
          await openSession(result);
          if (!session.dshSessionId) void fetchList();
        } catch (problem) {
          setFailure((previous) => ({ ...previous, [session.key]: problem.message }));
        } finally { setBusy(''); }
      };
      const terms = termsOf(query);
      const unavailable = data?.providers?.filter((provider) => provider.error) ?? [];
      const online = Array.isArray(phone?.devices) && phone.devices.some((device) => Date.now() - device.lastSeenAt < 180_000);
      const home = data?.home;
      return h('div', { className: 'dudu-page', 'data-testid': 'dudu-page' },
        h('div', { className: 'dudu-wrap' },
          h('div', { className: 'dudu-bar' },
            h('div', { className: 'dudu-search' }, h(Input, {
              type: 'text', className: 'dsbot-input', value: query, placeholder: '搜索会话', 'aria-label': '搜索会话',
              autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false, onChange: (event) => setQuery(event.target.value),
            })),
            data?.indexing?.running && h('span', { className: 'dudu-index', role: 'status' }, `索引 ${data.indexing.done} / ${data.indexing.total}`),
            h('div', { className: 'dudu-tabs', role: 'group', 'aria-label': '筛选' }, AGENTS.map((item) => h('button', {
              key: item.id, type: 'button', className: 'dudu-tab', 'aria-pressed': agent === item.id, onClick: () => setAgent(item.id),
            }, item.name))),
            h(Button, { size: 'sm', variant: 'outline', className: 'dsbot-button', onClick: () => { void fetchList(true); } }, '刷新'),
            phone && h('span', { className: 'dudu-phone', 'data-testid': 'dudu-phone' }, h('i', { className: `dudu-dot${online ? ' dudu-dot--on' : ''}` }), online ? '手机已连接' : '手机未连接')),
          !searching && h('div', { className: 'dudu-grid' },
            h('div', { className: 'dudu-col' }, h(UsageCard, { usage })),
            h('div', { className: 'dudu-col' }, h(RunningCard, { running, home, onOpen: (sessionId) => openSession({ sessionId }) }))),
          error && h('p', { className: 'dsbot-error', role: 'alert' }, `读取会话失败：${error}`),
          unavailable.map((provider) => h('p', { key: provider.id, className: 'dsbot-error', role: 'alert' }, `${provider.name}：${provider.error}`)),
          !searching && h('div', { className: 'dudu-section' }, h('span', null, '最近'),
            data && data.total > RECENT && h('button', { type: 'button', className: 'dudu-fold', onClick: () => setShowAll(!showAll) }, showAll ? '收起' : `全部 ${data.total}`)),
          !data && !error && h('div', { className: 'dudu-note' }, '…'),
          data && h('div', { className: 'dudu-list' },
            data.sessions.length === 0
              ? h('div', { className: 'dudu-note' }, searching ? '没有匹配的会话' : '没有会话')
              : data.sessions.map((session) => h(SessionRow, {
                key: session.key, session, home: data.home, terms, expanded: expanded === session.key, busy: busy === session.key,
                failure: failure[session.key], onToggle: () => setExpanded(expanded === session.key ? '' : session.key), onOpen: () => open(session),
              }))),
          searching && data && data.total > data.sessions.length && h('div', { className: 'dudu-count' }, `${data.sessions.length} / ${data.total}`)));
    }

    // Until DSH's session list holds a session it cannot be opened: some builds put a created session in the list at once,
    // others when the Host announces it a moment later.
    async function untilListed(sessions, sessionId, timeout = 5000) {
      const listed = () => {
        const state = sessions.list.getSnapshot();
        return state.ids.includes(sessionId) || sessionId in state.byId;
      };
      if (listed()) return;
      await new Promise((resolve) => {
        const done = () => { unsubscribe(); clearTimeout(timer); resolve(); };
        const unsubscribe = sessions.list.subscribe(() => { if (listed()) done(); });
        const timer = setTimeout(done, timeout);
        // Ask for the list again, and look again once it has answered: it may have changed before anyone was listening.
        Promise.resolve(sessions.refresh?.()).catch(() => {}).then(() => { if (listed()) done(); });
      });
    }

    // The panel needs services only some DSH builds have, so it is a plugin of its own that waits for them.
    const sessionsUi = {
      name: 'dudu-sessions',
      inject: ['slots', 'layout', 'uiWorkspace', 'sessions'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent = panelStyles;
          document.head.appendChild(style);
          return () => style.remove();
        });
        const Page = () => h(DuduPage, {
          // A session written by the host is stored, not yet running: DSH's own create resumes a stored session, which also
          // puts it in the session list, and only then can it be opened.
          openSession: async ({ sessionId, workspaceId }) => {
            await ctx.sessions.create({ sessionId, ...(workspaceId ? { workspaceId } : {}) });
            await untilListed(ctx.sessions, sessionId);
            ctx.uiWorkspace.openSession(sessionId);
            ctx.layout.selectPanel(null);
          },
        });
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Page));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '嘟嘟',
        }, DuduGlyph));
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
          ctx.plugin(sessionsUi);
        }
      },
    };
  },
});
