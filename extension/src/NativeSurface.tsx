import { useEffect, useRef, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { request } from './platform';
import { renderSurface, SURFACE_DOCUMENT } from './surface-frame';
import type { SurfaceAction, SurfaceSnapshot, TreeCard } from './tree-types';

export function NativeSurface({ card, pageUrl, messageId, index, label, dismiss, select }: { card: TreeCard; pageUrl: string; messageId: string; index: number; label: string; dismiss: () => void; select: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef<SurfaceSnapshot | undefined>(undefined);
  const running = useRef(false);
  const alive = useRef(true);
  const queue = useRef<SurfaceAction[]>([]);
  const frameCleanup = useRef<(() => void) | undefined>(undefined);
  const [active, setActive] = useState(typeof IntersectionObserver === 'undefined');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const callbacks = useRef({ dismiss, select });
  callbacks.current = { dismiss, select };

  function draw(snapshot: SurfaceSnapshot) {
    latest.current = snapshot;
    const doc = frame.current?.contentDocument;
    if (doc?.body) { renderSurface(doc, snapshot); measure(); setLoaded(true); }
  }
  function measure() {
    const node = frame.current;
    const root = node?.contentDocument?.body.firstElementChild;
    if (node && root) {
      const height = Math.min(2400, Math.max(160, Math.ceil(root.getBoundingClientRect().height), root.scrollHeight));
      if (node.style.height !== `${height}px`) node.style.height = `${height}px`;
    }
  }
  const sync = useRef<() => Promise<void>>(async () => {});
  sync.current = async () => {
    if (running.current || !alive.current) return;
    running.current = true;
    try {
      do {
        const action = queue.current.shift();
        const previous = latest.current;
        const result = await request({ type: 'tree:surface', rootKey: card.rootKey, pageUrl, id: card.id, messageId, index, ...(previous ? { session: previous.session, revision: previous.revision } : {}), ...(action ? { action } : {}) });
        if (!alive.current) return;
        if (result.surface) draw(result.surface);
        setError('');
      } while (queue.current.length);
    } catch (cause) {
      // Reads may be retried by the poll; user actions are never replayed.
      queue.current = [];
      if (alive.current) setError(cause instanceof Error ? cause.message : '界面同步失败，请重试。');
    } finally { running.current = false; }
  };

  useEffect(() => {
    alive.current = true;
    if (typeof IntersectionObserver === 'undefined') return () => { alive.current = false; frameCleanup.current?.(); };
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { root: host.current?.closest('.thread-history'), rootMargin: '80px' });
    if (host.current) observer.observe(host.current);
    return () => { alive.current = false; observer.disconnect(); frameCleanup.current?.(); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const tick = () => { if (document.visibilityState !== 'hidden') void sync.current(); };
    tick();
    const timer = setInterval(tick, 700);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [active]);

  function bind() {
    const node = frame.current;
    const doc = node?.contentDocument;
    if (!doc || !node) return;
    frameCleanup.current?.();
    const events = new AbortController();
    const options = { capture: true, signal: events.signal };
    if (latest.current) draw(latest.current);
    function enqueue(action: Omit<SurfaceAction, 'id' | 'session'>) {
      if (!latest.current) return;
      const last = queue.current.at(-1);
      const next: SurfaceAction = { ...action, id: crypto.randomUUID(), session: latest.current.session, createdAt: Date.now() };
      if (action.type === 'input' && last?.type === 'input' && last.target === next.target) queue.current[queue.current.length - 1] = next;
      else if (queue.current.length < 24) queue.current.push(next);
      void sync.current();
    }
    function target(event: Event) {
      return (event.target as Node | null)?.nodeType === 1 ? (event.target as Element).closest<HTMLElement>('[data-lattice-node]') : null;
    }
    doc.addEventListener('click', (event) => {
      const element = target(event); if (!element) return;
      if (element.closest('button,a,label,input[type="checkbox"],input[type="radio"],summary,[role="button"],[role="tab"]')) event.preventDefault();
      const bounds = element.getBoundingClientRect();
      enqueue({ type: 'click', target: element.dataset.latticeNode!, x: bounds.width ? (event.clientX - bounds.left) / bounds.width : .5, y: bounds.height ? (event.clientY - bounds.top) / bounds.height : .5 });
    }, options);
    for (const type of ['input', 'change'] as const) doc.addEventListener(type, (event) => {
      const element = target(event);
      if (element && /^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) enqueue({ type, target: element.dataset.latticeNode!, value: (element as HTMLInputElement).value });
    }, options);
    doc.addEventListener('keydown', (event) => {
      const element = target(event); if (!element) return;
      if (event.key === 'Escape' && !doc!.querySelector('[data-lattice-portal-anchor]')) { event.preventDefault(); callbacks.current.dismiss(); return; }
      if (!element.matches('input,textarea,select') && (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key) || !element.matches('button') && ['Enter', ' '].includes(event.key))) {
        event.preventDefault(); enqueue({ type: 'keydown', target: element.dataset.latticeNode!, key: event.key });
      }
    }, options);
    doc.addEventListener('mouseup', () => {
      const text = doc.getSelection()?.toString().trim();
      if (text) callbacks.current.select(text.slice(0, 2000));
    }, { signal: events.signal });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (doc.body) observer?.observe(doc.body);
    frameCleanup.current = () => { events.abort(); observer?.disconnect(); };
    doc.fonts?.ready.then(measure).catch(() => undefined);
  }
  return <div className="native-surface" ref={host} aria-label={label}>
    {!loaded && <p className="native-surface-loading" role="status">正在加载交互内容…</p>}
    <iframe ref={frame} title={label} className="native-surface-frame" sandbox="allow-same-origin" srcDoc={SURFACE_DOCUMENT} onLoad={bind} style={{ visibility: loaded ? 'visible' : 'hidden' }} />
    {error && <div className="native-surface-error" role="status"><span>{error}</span><button type="button" onClick={() => { latest.current = undefined; void sync.current(); }} aria-label={`重新同步：${label}`}><RotateCw size={13} />重试</button></div>}
  </div>;
}
