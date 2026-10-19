import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSurfaceBridge } from './native-surface';
import { projectContent } from './native-relay';
import { renderSurface, SURFACE_DOCUMENT } from './surface-frame';
import type { SurfaceSnapshot } from './tree-types';

let bridge: ReturnType<typeof createSurfaceBridge>;
let root: HTMLElement;
const query = { type: 'native:surface' as const, key: 'chatgpt:branch', messageId: 'message:ui', index: 0 };
async function snapshot() {
  const result = await bridge.read(query);
  if (!result.ok || !result.surface) throw new Error('No surface');
  return result.surface;
}
function nodeId(value: SurfaceSnapshot, selector: string) { return new DOMParser().parseFromString(value.html, 'text/html').querySelector(selector)!.getAttribute('data-lattice-node')!; }

beforeEach(() => {
  document.body.innerHTML = '<div data-dil-source-message-id="ui"><h2>Native lab</h2><button id="run">Run</button><label>Layout<select id="layout"><option value="row">Row</option><option value="column">Column</option></select></label><input id="range" type="range" value="4"><input id="check" type="checkbox"><output id="out">0</output><svg viewBox="0 0 20 20"><path d="M0 0L20 20" /></svg></div>';
  root = document.body.firstElementChild as HTMLElement;
  bridge = createSurfaceBridge(() => root, () => 'chatgpt:branch');
});
afterEach(() => { bridge.dispose(); vi.useRealTimers(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('native surfaces without executing duplicated application code', () => {
  it('preserves layout, SVG, controls and original handlers, and relays a click once', async () => {
    const html = root.outerHTML;
    let count = 0;
    root.querySelector('button')!.addEventListener('click', () => { root.querySelector('output')!.textContent = String(++count); });
    const first = await snapshot();
    expect(first.html).toContain('viewBox="0 0 20 20"');
    expect(first.html).toContain('type="range"');
    expect(root.outerHTML).toBe(html);
    const action = { id: 'once', session: first.session, type: 'click' as const, target: nodeId(first, '#run') };
    const result = await bridge.read({ ...query, action });
    expect(result.ok && result.surface?.html).toContain('>1</output>');
    await bridge.read({ ...query, action });
    expect(count).toBe(1);
    expect(root.querySelector('[data-lattice-node]')).toBeNull();
  });

  it('updates the real native input/select state and rejects a stale route or control', async () => {
    const change = vi.fn(); root.querySelector('select')!.addEventListener('change', change);
    const first = await snapshot();
    const action = { id: 'select', session: first.session, type: 'change' as const, target: nodeId(first, '#layout'), value: 'column' };
    await bridge.read({ ...query, action });
    expect(root.querySelector('select')!.value).toBe('column');
    expect(change).toHaveBeenCalledOnce();
    expect((await bridge.read({ ...query, key: 'chatgpt:other', action: { ...action, id: 'wrong' } })).ok).toBe(false);
    root.querySelector('select')!.remove();
    expect((await bridge.read({ ...query, action: { ...action, id: 'removed' } })).ok).toBe(false);
    expect(change).toHaveBeenCalledOnce();
  });

  it('limits animation snapshots, returns no unchanged payload and expires inactive views', async () => {
    vi.useFakeTimers();
    const first = await snapshot();
    expect(await bridge.read({ ...query, session: first.session, revision: first.revision })).toEqual({ ok: true });
    let published = 0;
    for (let frame = 0; frame < 20; frame++) {
      root.querySelector('output')!.textContent = String(frame);
      await vi.advanceTimersByTimeAsync(25);
      const result = await bridge.read({ ...query, session: first.session, revision: first.revision });
      if (result.ok && result.surface) published++;
    }
    expect(published).toBe(1);
    await vi.advanceTimersByTimeAsync(8100);
    expect((await snapshot()).session).not.toBe(first.session);
  });

  it('removes executable elements and unsafe attributes while keeping surrounding prose in order', async () => {
    root.innerHTML += '<script>window.bad=true</script><img src="javascript:alert(1)" onerror="bad()"><iframe src="https://example.org"></iframe><input type="password" value="private">';
    const result = await snapshot();
    expect(result.html).not.toMatch(/<script|<iframe|onerror|javascript:|value="private"/);
    const answer = document.createElement('div');
    answer.innerHTML = '<p>Before <b>term</b></p><div data-dil-source-message-id="x"><h2>Native lab</h2><div data-dil-message-id="x">Nested</div></div><p>After</p>';
    expect(projectContent(answer)).toEqual([{ type: 'markdown', markdown: 'Before **term**' }, { type: 'native', index: 0, label: 'Native lab' }, { type: 'markdown', markdown: 'After' }]);
  });

  it('captures owned portal menus and routes their items to the same native application', async () => {
    root.querySelector('button')!.setAttribute('aria-controls', 'native-menu');
    const portal = document.createElement('div'); portal.innerHTML = '<div role="menu" id="native-menu"><button id="choice">Choice</button></div>'; document.body.append(portal);
    const click = vi.fn(); portal.querySelector('button')!.addEventListener('click', click);
    const first = await snapshot();
    expect(first.html).toContain('data-lattice-portal-anchor');
    await bridge.read({ ...query, action: { id: 'portal', session: first.session, type: 'click', target: nodeId(first, '#choice') } });
    expect(click).toHaveBeenCalledOnce();
  });
  it('keeps form layout while preventing direct submission, and never adopts the native composer', async () => {
    root.innerHTML = '<form class="native-form" action="https://example.org/submit"><input value="draft"><button aria-controls="prompt-textarea">Submit</button></form>';
    const composer = document.createElement('textarea'); composer.id = 'prompt-textarea'; composer.value = 'Private native draft'; document.body.append(composer);
    const value = await snapshot();
    expect(value.html).toContain('class="native-form"');
    expect(value.html).toContain('value="draft"');
    expect(value.html).not.toMatch(/<form|action=|Private native draft/);
  });
  it('relays a native checkbox activation without duplicating its change event', async () => {
    const checkbox = root.querySelector<HTMLInputElement>('#check')!;
    const change = vi.fn(); checkbox.addEventListener('change', change);
    const first = await snapshot();
    await bridge.read({ ...query, action: { id: 'check', session: first.session, target: nodeId(first, '#check'), type: 'click' } });
    expect(checkbox.checked).toBe(true); expect(change).toHaveBeenCalledOnce();
  });
  it('never executes an expired action after a source tab wakes up', async () => {
    const click = vi.fn(); root.querySelector('button')!.addEventListener('click', click);
    const first = await snapshot();
    const result = await bridge.read({ ...query, action: { id: 'late', session: first.session, target: nodeId(first, '#run'), type: 'click', createdAt: Date.now() - 6000 } });
    expect(result.ok).toBe(false); expect(click).not.toHaveBeenCalled();
  });
});

describe('isolated frame reconciliation', () => {
  it('keeps frame nodes, text caret, handlers and scroll across updates from a different realm', () => {
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    const doc = iframe.contentDocument!;
    const value: SurfaceSnapshot = { session: 's', revision: 1, html: '<div data-lattice-surface-root><div data-lattice-node="n1"><input data-lattice-node="n2" value="draft"><output data-lattice-node="n3">Before</output></div></div>', css: 'input{color:red}', stylesheets: [], rootClass: 'light', dir: 'ltr', height: 200 };
    renderSurface(doc, value);
    const input = doc.querySelector('input')!; const output = doc.querySelector('output')!;
    const click = vi.fn(); input.addEventListener('click', click);
    input.focus(); input.value = 'unsent edit'; input.setSelectionRange(4,4); doc.body.firstElementChild!.scrollTop = 16;
    renderSurface(doc, { ...value, revision: 2, html: value.html.replace('Before', 'After') });
    expect(doc.querySelector('input')).toBe(input); expect(doc.querySelector('output')).toBe(output);
    expect(doc.activeElement).toBe(input); expect(input.value).toBe('unsent edit'); expect(input.selectionStart).toBe(4);
    expect(output.textContent).toBe('After'); expect(doc.body.firstElementChild!.scrollTop).toBe(16);
    input.click(); expect(click).toHaveBeenCalledOnce();
    expect(SURFACE_DOCUMENT).toContain("script-src 'none'");
  });
});
