import { collectChat } from "./host";
import { NATIVE_INTERACTIVE } from "./native-content";
import { platform } from "./platform";
import { conversationKey } from "./presentation";
import type { SurfaceAction, SurfaceRequest, SurfaceSnapshot } from "./tree-types";
import type { ExtensionResponse } from "./types";

const TAGS = new Set('div span p section article header footer main nav aside h1 h2 h3 h4 h5 h6 button input textarea select option optgroup label fieldset legend output meter progress details summary ul ol li dl dt dd table thead tbody tfoot tr td th caption colgroup col a img picture source pre code blockquote strong em b i u s small sub sup br hr style svg g path rect circle ellipse line polyline polygon text tspan defs clippath mask lineargradient radialgradient stop use symbol title desc foreignobject'.split(' '));
const ATTRS = new Set('class id style role dir lang title hidden tabindex type name value checked selected disabled readonly multiple placeholder min max step rows cols size maxlength for open colspan rowspan scope width height alt loading decoding viewbox preserveaspectratio d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity fill-opacity stroke-opacity x y x1 y1 x2 y2 cx cy r rx ry points transform offset stop-color stop-opacity clip-path mask patternunits gradientunits gradienttransform xmlns'.split(' '));
const LIMIT = 6000;
const LEASE = 8000;
const COOLDOWN = 500;

function url(value: string, base: string): string | null {
  if (value.startsWith('#')) return value;
  try {
    const parsed = new URL(value, base);
    return /^https?:$/.test(parsed.protocol) || /^data:image\//i.test(value) || parsed.protocol === 'blob:' && parsed.origin === new URL(base).origin ? parsed.href : null;
  } catch { return null; }
}

export function nativeSurfaces(element: HTMLElement): HTMLElement[] {
  return [ ...(element.matches(NATIVE_INTERACTIVE) ? [element] : []), ...element.querySelectorAll<HTMLElement>(NATIVE_INTERACTIVE) ].filter((node) => { const parent = node.parentElement?.closest(NATIVE_INTERACTIVE); return !parent || !element.contains(parent); });
}

interface Entry {
  root: HTMLElement; roots: HTMLElement[]; session: string; revision: number; dirty: boolean; captured: number;
  ids: WeakMap<Element, string>; nodes: Map<string, Element>; next: number; observer: MutationObserver;
  timer?: ReturnType<typeof setTimeout>; snapshot?: SurfaceSnapshot; theme: string; seen: Set<string>;
}

// Only the requested, visible card is sampled. No application HTML is placed in
// local/session storage, and no native script or event handler is copied.
export function createSurfaceBridge(find: (messageId: string, index: number) => HTMLElement | undefined, currentKey: () => string | null) {
  const entries = new Map<string, Entry>();
  function dispose(key: string) {
    const entry = entries.get(key);
    entry?.observer.disconnect(); clearTimeout(entry?.timer); entries.delete(key);
  }
  function id(entry: Entry, element: Element) {
    let value = entry.ids.get(element);
    if (!value) { value = `n${++entry.next}`; entry.ids.set(element, value); }
    entry.nodes.set(value, element);
    return value;
  }
  function ownedRoots(entry: Entry) {
    const roots: HTMLElement[] = [entry.root];
    const doc = entry.root.ownerDocument;
    for (const control of entry.root.querySelectorAll<HTMLElement>('[aria-controls], [aria-owns]')) {
      for (const ref of `${control.getAttribute('aria-controls') ?? ''} ${control.getAttribute('aria-owns') ?? ''}`.split(/\s+/).filter(Boolean)) {
        const content = doc.getElementById(ref);
        if (!content || entry.root.contains(content)) continue;
        if (!content.matches('[role="menu"], [role="listbox"], [role="tooltip"]')) continue;
        const portal = content.closest<HTMLElement>('[data-radix-popper-content-wrapper]') ?? content;
        if (!roots.includes(portal) && !roots.some((root) => root.contains(portal))) roots.push(portal);
      }
    }
    return roots.slice(0, 5);
  }
  function clone(entry: Entry, source: Node, budget: { count: number }): Node | null {
    if (++budget.count > LIMIT) throw new Error('交互界面过大，暂时无法同步。');
    const doc = entry.root.ownerDocument;
    if (source.nodeType === Node.TEXT_NODE) return doc.createTextNode(source.textContent ?? '');
    if (!(source instanceof Element)) return null;
    if (source.localName === 'canvas') {
      const image = doc.createElement('img');
      image.setAttribute('data-lattice-node', id(entry, source));
      try { image.src = (source as HTMLCanvasElement).toDataURL(); } catch { image.alt = '此画布受浏览器跨域保护，暂不能同步'; }
      image.width = (source as HTMLCanvasElement).width; image.height = (source as HTMLCanvasElement).height;
      image.setAttribute('style', source.getAttribute('style') ?? 'max-width:100%;height:auto');
      return image;
    }
    if (!TAGS.has(source.localName.toLowerCase()) && source.localName !== 'form') return null;
    const copy = source.localName === 'form' ? doc.createElement('div') : source.cloneNode(false) as Element;
    if (source.localName === 'form') for (const attribute of source.attributes) copy.setAttribute(attribute.name, attribute.value);
    for (const attribute of [...copy.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === 'href' || name === 'src' || name === 'xlink:href') {
        const safe = url(attribute.value, doc.baseURI);
        if (safe) copy.setAttribute(attribute.name, safe); else copy.removeAttribute(attribute.name);
      } else if (name.startsWith('on') || !(ATTRS.has(name) || name.startsWith('aria-') || name.startsWith('data-'))) copy.removeAttribute(attribute.name);
    }
    copy.setAttribute('data-lattice-node', id(entry, source));
    if (source instanceof HTMLInputElement) {
      if (['file', 'password'].includes(source.type)) { copy.removeAttribute('value'); copy.setAttribute('disabled', ''); copy.setAttribute('title', '此控件需要浏览器原生授权'); }
      else { copy.setAttribute('value', source.value); copy.toggleAttribute('checked', source.checked); }
    }
    if (source instanceof HTMLOptionElement) copy.toggleAttribute('selected', source.selected);
    if (source instanceof HTMLStyleElement) { try { copy.textContent = source.sheet ? [...source.sheet.cssRules].map((rule) => rule.cssText).join('\n') : source.textContent; } catch { copy.textContent = source.textContent; } }
    else if (source instanceof HTMLTextAreaElement) copy.textContent = source.value;
    else for (const child of source.childNodes) { const result = clone(entry, child, budget); if (result) copy.append(result); }
    return copy;
  }
  function inherit(element: HTMLElement) {
    const computed = getComputedStyle(element);
    const properties = ['font-family', 'font-size', 'line-height', 'color', ...Array.from(computed).filter((key) => key.startsWith('--'))];
    return properties.map((key) => `${key}:${computed.getPropertyValue(key)};`).join('');
  }
  function capture(entry: Entry): SurfaceSnapshot {
    const doc = entry.root.ownerDocument;
    const wrapper = doc.createElement('div');
    wrapper.setAttribute('data-lattice-surface-root', '');
    wrapper.setAttribute('style', inherit(entry.root));
    const budget = { count: 0 };
    for (const [index, root] of entry.roots.entries()) {
      const copy = clone(entry, root, budget) as HTMLElement;
      if (!copy) continue;
      if (index) {
        const anchor = [...entry.root.querySelectorAll<HTMLElement>('[aria-controls], [aria-owns]')].find((node) => `${node.getAttribute('aria-controls') ?? ''} ${node.getAttribute('aria-owns') ?? ''}`.split(/\s+/).some((ref) => root.id === ref || !!root.ownerDocument.getElementById(ref) && root.contains(root.ownerDocument.getElementById(ref))));
        if (anchor) copy.setAttribute('data-lattice-portal-anchor', id(entry, anchor));
        copy.style.cssText += ';' + inherit(root);
      }
      wrapper.append(copy);
    }
    const theme = doc.documentElement.className + '|' + doc.body.className;
    const reuseStyles = entry.snapshot && entry.theme === theme;
    const css = reuseStyles ? entry.snapshot!.css : [
      ...[...doc.querySelectorAll<HTMLStyleElement>('head style')].map((style) => { try { return style.sheet ? [...style.sheet.cssRules].map((rule) => rule.cssText).join('\n') : style.textContent ?? ''; } catch { return style.textContent ?? ''; } }),
      ...[...doc.adoptedStyleSheets ?? []].map((sheet) => [...sheet.cssRules].map((rule) => rule.cssText).join('\n'))
    ].join('\n');
    const stylesheets = reuseStyles ? entry.snapshot!.stylesheets : [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) => url(link.href, doc.baseURI)).filter((href): href is string => !!href && /^https?:/.test(href));
    const snapshot: SurfaceSnapshot = { session: entry.session, revision: ++entry.revision, html: wrapper.outerHTML, css, stylesheets, rootClass: doc.documentElement.className, dir: doc.documentElement.dir || 'ltr', height: Math.min(2400, Math.max(180, entry.root.scrollHeight)) };
    if (JSON.stringify(snapshot).length > 3_500_000) throw new Error('交互界面较大，请稍后重试同步。');
    for (const [key, node] of entry.nodes) if (!entry.roots.some((root) => root === node || root.contains(node))) entry.nodes.delete(key);
    entry.theme = theme; entry.snapshot = snapshot; entry.captured = Date.now(); entry.dirty = false;
    return snapshot;
  }
  function apply(entry: Entry, action: SurfaceAction) {
    if (action.createdAt !== undefined && (Date.now() - action.createdAt > 4000 || action.createdAt > Date.now() + 1000)) throw new Error('操作已过期，未执行，请重试。');
    if (action.session !== entry.session) throw new Error('交互界面已重新加载，请刷新卡片后重试。');
    if (entry.seen.has(action.id)) return;
    const element = entry.nodes.get(action.target);
    if (!(element instanceof HTMLElement || element instanceof SVGElement) || !element.isConnected || !entry.roots.some((root) => root === element || root.contains(element))) throw new Error('控件已更新，请重试。');
    if (element.matches(':disabled, [aria-disabled="true"], input[type="file"], input[type="password"]')) throw new Error('此控件当前不可操作。');
    entry.seen.add(action.id);
    if (entry.seen.size > 512) entry.seen.delete(entry.seen.values().next().value!);
    const focus = element.closest('button,input,textarea,select,[tabindex],a[href]');
    if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
    if (action.type === 'input' || action.type === 'change') {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (typeof action.value !== 'string' || action.value.length > 20000) throw new Error('输入内容无效。');
        const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, action.value);
        element.dispatchEvent(new Event(action.type, { bubbles: true, composed: true }));
      } else throw new Error('此控件不支持文本输入。');
    } else if (action.type === 'keydown') {
      if (!action.key || action.key.length > 32) throw new Error('按键无效。');
      element.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, bubbles: true, composed: true }));
    } else if (action.type === 'click') {
      const bounds = element.getBoundingClientRect();
      const clientX = bounds.left + bounds.width * Math.max(0, Math.min(1, action.x ?? .5));
      const clientY = bounds.top + bounds.height * Math.max(0, Math.min(1, action.y ?? .5));
      const Input = window.PointerEvent ?? MouseEvent;
      element.dispatchEvent(new Input('pointerdown', { bubbles: true, composed: true, button: 0, buttons: 1, clientX, clientY }));
      element.dispatchEvent(new Input('pointerup', { bubbles: true, composed: true, button: 0, buttons: 0, clientX, clientY }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, clientX, clientY }));
    } else throw new Error('不支持的控件操作。');
    entry.dirty = true;
  }
  return {
    async read(message: SurfaceRequest): Promise<ExtensionResponse> {
      if (currentKey() !== message.key || !Number.isInteger(message.index) || message.index < 0) return { ok: false, error: '原生支线已切换，未执行控件操作。' };
      const root = find(message.messageId, message.index);
      if (!root) return { ok: false, error: '正在加载原生交互内容…' };
      const key = `${message.messageId}:${message.index}`;
      let entry = entries.get(key);
      if (!entry || entry.root !== root) {
        dispose(key);
        if (entries.size >= 4) dispose(entries.keys().next().value!);
        const observer = new MutationObserver(() => { entry!.dirty = true; });
        entry = { root, roots: [], session: crypto.randomUUID(), revision: 0, dirty: true, captured: 0, ids: new WeakMap(), nodes: new Map(), next: 0, observer, theme: '', seen: new Set() };
        entries.set(key, entry);
      }
      clearTimeout(entry.timer); entry.timer = setTimeout(() => dispose(key), LEASE);
      const roots = ownedRoots(entry);
      if (roots.length !== entry.roots.length || roots.some((item, i) => item !== entry!.roots[i])) {
        entry.observer.disconnect(); entry.roots = roots; entry.dirty = true;
        for (const item of roots) entry.observer.observe(item, { subtree: true, childList: true, attributes: true, characterData: true });
      }
      try {
        if (message.action) { apply(entry, message.action); await Promise.resolve(); }
        if (entry.observer.takeRecords().length) entry.dirty = true;
        if (entry.theme !== root.ownerDocument.documentElement.className + '|' + root.ownerDocument.body.className || root.querySelector('canvas')) entry.dirty = true;
        if (!entry.snapshot || entry.dirty && (message.action || Date.now() - entry.captured >= COOLDOWN)) capture(entry);
        return { ok: true, ...(message.session !== entry.session || message.revision !== entry.revision ? { surface: entry.snapshot } : {}) };
      } catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : '交互内容同步失败，请重试。' }; }
    },
    dispose() { for (const key of entries.keys()) dispose(key); }
  };
}

export function startSurfaceRelay() {
  const bridge = createSurfaceBridge((messageId, index) => {
    const answer = collectChat().answers.find((item) => item.id === messageId);
    return answer ? nativeSurfaces(answer.contentElement)[index] : undefined;
  }, () => conversationKey(location.href));
  const api = platform();
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type !== 'native:surface' || sender.tab || api.runtime.id && sender.id !== api.runtime.id) return;
    void bridge.read(message).then(respond, () => respond({ ok: false, error: '交互内容同步失败。' }));
    return true;
  });
  window.addEventListener('pagehide', () => bridge.dispose(), { once: true });
}
