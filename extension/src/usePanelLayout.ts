import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { DEFAULT_PANEL_WIDTH, PANEL_WIDTH_KEY, panelLayout, readPanelWidth } from "./panel-layout";
import { platform } from "./platform";
import { activeMain } from "./host";

const measure = () => ({ width: document.documentElement.clientWidth || window.innerWidth, left: activeMain()?.getBoundingClientRect().left ?? 0 });

export function usePanelLayout(hidden = false) {
  const main = activeMain();
  const [viewport, setViewport] = useState(measure);
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [compactOpen, setCompactOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [resizing, setResizing] = useState(false);
  const changed = useRef(false);
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number; width: number } | null>(null);
  const layout = panelLayout(viewport.width, viewport.left, preferredWidth, wide);
  const compactRef = useRef(layout.compact);
  const open = layout.compact ? compactOpen : desktopOpen;
  const visible = open && !hidden;

  useEffect(() => {
    const update = () => {
      const next = measure();
      const compact = panelLayout(next.width, next.left, DEFAULT_PANEL_WIDTH).compact;
      if (compact !== compactRef.current) { setCompactOpen(false); compactRef.current = compact; }
      setViewport((previous) => previous.width === next.width && previous.left === next.left ? previous : next);
    };
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    if (main) observer.observe(main);
    update();
    return () => { window.removeEventListener("resize", update); observer.disconnect(); };
  }, [main]);

  useEffect(() => {
    let stopped = false;
    void platform().storage.local.get(PANEL_WIDTH_KEY).then((values) => {
      const width = readPanelWidth(values[PANEL_WIDTH_KEY]);
      if (!stopped && !changed.current && width !== null) setPreferredWidth(width);
    }).catch(() => { /* Resizing still works when extension storage is unavailable. */ });
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previousWidth = root.style.getPropertyValue("--lattice-panel-width");
    root.dataset.latticeOpen = String(visible);
    root.dataset.latticeLayout = visible ? layout.compact ? "overlay" : "docked" : "closed";
    root.style.setProperty("--lattice-panel-width", `${layout.width}px`);
    return () => {
      root.removeAttribute("data-lattice-open");
      root.removeAttribute("data-lattice-layout");
      if (previousWidth) root.style.setProperty("--lattice-panel-width", previousWidth);
      else root.style.removeProperty("--lattice-panel-width");
    };
  }, [visible, layout.compact, layout.width]);

  const setOpen = useCallback((value: boolean) => {
    if (layout.compact) setCompactOpen(value);
    else setDesktopOpen(value);
  }, [layout.compact]);

  function saveWidth(width: number) {
    changed.current = true;
    void platform().storage.local.set({ [PANEL_WIDTH_KEY]: width }).catch(() => {});
  }

  function resize(width: number) {
    const next = Math.round(Math.min(layout.maxWidth, Math.max(layout.minWidth, width)));
    changed.current = true;
    setWide(false);
    setPreferredWidth(next);
    return next;
  }

  function finishResize(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const width = drag.current.width;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    saveWidth(width);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let width: number;
    switch (event.key) {
      case "ArrowLeft": width = layout.width + (event.shiftKey ? 40 : 10); break;
      case "ArrowRight": width = layout.width - (event.shiftKey ? 40 : 10); break;
      case "Home": width = layout.minWidth; break;
      case "End": width = layout.maxWidth; break;
      default: return;
    }
    event.preventDefault();
    saveWidth(resize(width));
  }

  return { ...layout, open, visible, wide, resizing, setOpen, setWide, resizeProps: {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: layout.width, width: layout.width };
      changed.current = true;
      setResizing(true);
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current.width = resize(drag.current.startWidth + drag.current.startX - event.clientX);
    },
    onPointerUp: finishResize,
    onPointerCancel: finishResize,
    onLostPointerCapture: finishResize,
    onKeyDown,
    onDoubleClick() { setWide(false); setPreferredWidth(DEFAULT_PANEL_WIDTH); saveWidth(DEFAULT_PANEL_WIDTH); }
  } };
}
