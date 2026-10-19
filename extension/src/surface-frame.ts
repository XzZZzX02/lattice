import type { SurfaceSnapshot } from './tree-types';

export const SURFACE_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' https: http:; img-src https: http: data: blob:; font-src https: data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'"></head><body></body></html>`;

const element = (node: Node): node is Element => node.nodeType === 1;

function same(a: Node, b: Node) {
  return a.nodeType === b.nodeType && (!(element(a)) || element(b) && a.localName === b.localName && a.getAttribute('data-lattice-node') === b.getAttribute('data-lattice-node'));
}

// Reconcile stable native node IDs instead of reloading the frame on every
// update. This retains selection, keyboard focus, text carets and scroll.
export function patchSurface(parent: Element, next: Element) {
  const focused = parent.ownerDocument.activeElement;
  function patch(old: Node, fresh: Node) {
    if (old.nodeType === Node.TEXT_NODE) { if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue; return; }
    if (!(element(old)) || !(element(fresh))) return;
    for (const attribute of [...old.attributes]) if (!fresh.hasAttribute(attribute.name)) old.removeAttribute(attribute.name);
    for (const attribute of fresh.attributes) if (old.getAttribute(attribute.name) !== attribute.value) old.setAttribute(attribute.name, attribute.value);
    if (old.tagName === 'INPUT') (old as HTMLInputElement).checked = (fresh as HTMLInputElement).checked;
    if (old !== focused) {
      if (old.tagName === 'INPUT') { (old as HTMLInputElement).value = (fresh as HTMLInputElement).value; (old as HTMLInputElement).checked = (fresh as HTMLInputElement).checked; }
      if (old.tagName === 'TEXTAREA') (old as HTMLTextAreaElement).value = (fresh as HTMLTextAreaElement).value;
      if (old.tagName === 'SELECT') (old as HTMLSelectElement).value = (fresh as HTMLSelectElement).value;
    }
    const keyed = new Map([...old.childNodes].filter((node): node is Element => element(node) && node.hasAttribute('data-lattice-node')).map((node) => [node.getAttribute('data-lattice-node'), node]));
    let cursor = old.firstChild;
    for (const child of fresh.childNodes) {
      const key = element(child) ? child.getAttribute('data-lattice-node') : null;
      let retained: Node | undefined = key ? keyed.get(key) : cursor && same(cursor, child) ? cursor : undefined;
      if (!retained || !same(retained, child)) retained = child.cloneNode(true);
      if (retained !== cursor) old.insertBefore(retained, cursor);
      patch(retained, child);
      cursor = retained.nextSibling;
    }
    while (cursor) { const next = cursor.nextSibling; old.removeChild(cursor); cursor = next; }
  }
  patch(parent, next);
}

export function renderSurface(doc: Document, snapshot: SurfaceSnapshot) {
  doc.documentElement.className = snapshot.rootClass;
  doc.documentElement.dir = snapshot.dir;
  let styles = doc.getElementById('lattice-surface-styles');
  if (!styles) { styles = doc.createElement('style'); styles.id = 'lattice-surface-styles'; doc.head.append(styles); }
  const css = snapshot.css + '\nhtml,body{margin:0!important;padding:0!important;min-height:0!important;height:auto!important;width:100%!important;overflow-x:auto!important} [data-lattice-surface-root]{display:flow-root;min-width:0} [data-lattice-portal-anchor]{position:fixed!important;transform:none!important;z-index:2147483640!important}';
  if (styles.textContent !== css) styles.textContent = css;
  for (const href of snapshot.stylesheets) if (![...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some((link) => link.href === href)) {
    const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; doc.head.append(link);
  }
  const parsed = new DOMParser().parseFromString(snapshot.html, 'text/html');
  // Defense in depth at the rendering boundary, even with a trusted relay.
  for (const element of parsed.querySelectorAll('script,iframe,object,embed,base,meta,link,form')) element.remove();
  for (const element of parsed.querySelectorAll('*')) for (const attribute of [...element.attributes]) {
    if (/^on/i.test(attribute.name) || /^(srcdoc|action|formaction|srcset)$/i.test(attribute.name) || /^(href|src|xlink:href)$/i.test(attribute.name) && !/^(https?:|data:image\/|blob:|#)/i.test(attribute.value)) element.removeAttribute(attribute.name);
  }
  const next = parsed.body.firstElementChild;
  if (!next) return;
  const existing = doc.body.firstElementChild;
  if (existing) patchSurface(existing, next); else doc.body.append(doc.importNode(next, true));
  for (const portal of doc.querySelectorAll<HTMLElement>('[data-lattice-portal-anchor]')) {
    const anchor = [...doc.querySelectorAll<HTMLElement>('[data-lattice-node]')].find((node) => node.dataset.latticeNode === portal.dataset.latticePortalAnchor);
    if (!anchor) continue;
    const bounds = anchor.getBoundingClientRect();
    portal.style.setProperty('left', `${Math.max(4, Math.min(bounds.left, doc.documentElement.clientWidth - portal.offsetWidth - 4))}px`, 'important');
    portal.style.setProperty('top', `${bounds.bottom + 4}px`, 'important');
  }
}
