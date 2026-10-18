import { useEffect, useId, useRef, useState } from "react";
import { Check, Paintbrush } from "lucide-react";
import { THEME_OPTIONS, type useTheme } from "./useTheme";

export function ThemeMenu({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = THEME_OPTIONS.find((option) => option.value === theme.mode)!;

  useEffect(() => {
    if (!open) return;
    const element = container.current!;
    element.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: Event) => {
      // composedPath keeps clicks and focus inside our Shadow DOM recognizable.
      if (!event.composedPath().includes(element)) setOpen(false);
    };
    const owner = element.ownerDocument;
    owner.addEventListener("pointerdown", dismiss, true);
    owner.addEventListener("focusin", dismiss, true);
    return () => {
      owner.removeEventListener("pointerdown", dismiss, true);
      owner.removeEventListener("focusin", dismiss, true);
    };
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return <div className="theme-picker" ref={container} onKeyDown={(event) => {
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Tab") close();
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...container.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
    const index = items.indexOf(event.target as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }}>
    <button ref={trigger} type="button" className="icon-button" aria-label="Lattice 主题" title={`主题：${current.label}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={!theme.ready || theme.saving} onClick={() => setOpen(!open)} onKeyDown={(event) => {
      if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setOpen(true); }
    }}><Paintbrush size={15} /></button>
    {open && <div id={menuId} className="theme-menu" role="menu" aria-label="选择主题">{THEME_OPTIONS.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={theme.mode === option.value} tabIndex={-1} onClick={() => { close(); void theme.select(option.value); }}><Check size={14} aria-hidden="true" /><span>{option.label}</span></button>)}</div>}
  </div>;
}
