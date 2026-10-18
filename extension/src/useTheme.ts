import { useEffect, useState } from "react";
import { platform } from "./platform";

export const THEME_KEY = "lattice:theme:v1";
type Theme = "lattice" | "native";
type Scheme = "light" | "dark";
const readTheme = (value: unknown): Theme => value === "native" ? "native" : "lattice";

export function nativeScheme(): Scheme {
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue;
    if (element.classList.contains("dark")) return "dark";
    if (element.classList.contains("light")) return "light";
    const explicit = element.getAttribute("data-theme") || element.style.colorScheme;
    if (explicit === "dark" || explicit === "light") return explicit;
  }
  const computed = getComputedStyle(document.documentElement).colorScheme;
  if (computed === "dark" || computed === "light") return computed;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [mode, setMode] = useState<Theme>("lattice");
  const [scheme, setScheme] = useState(nativeScheme);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    let revision = 0;
    const storage = platform().storage;
    const changed: Parameters<typeof storage.onChanged.addListener>[0] = (changes, area) => {
      if (area !== "local" || !(THEME_KEY in changes)) return;
      revision++;
      setMode(readTheme(changes[THEME_KEY].newValue));
      setReady(true);
    };
    storage.onChanged.addListener(changed);
    const initialRevision = revision;
    void storage.local.get(THEME_KEY).then((values) => {
      if (!stopped && revision === initialRevision) { setMode(readTheme(values[THEME_KEY])); setReady(true); }
    }).catch(() => { if (!stopped) { setReady(true); setError("无法读取主题偏好，请刷新页面重试。"); } });
    return () => { stopped = true; storage.onChanged.removeListener(changed); };
  }, []);

  useEffect(() => {
    if (mode !== "native") return;
    const update = () => setScheme(nativeScheme());
    const observer = new MutationObserver(update);
    // Root attributes only: never subscribe to the live Intelligent UI subtree.
    const options = { attributes: true, attributeFilter: ["class", "style", "data-theme"] };
    observer.observe(document.documentElement, options);
    observer.observe(document.body, options);
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener?.("change", update);
    update();
    return () => { observer.disconnect(); media.removeEventListener?.("change", update); };
  }, [mode]);

  async function toggle() {
    if (!ready || saving) return;
    const next = mode === "lattice" ? "native" : "lattice";
    setSaving(true);
    setMode(next);
    try { await platform().storage.local.set({ [THEME_KEY]: next }); setError(""); }
    catch { setMode(mode); setError("主题偏好保存失败，请重试。"); }
    finally { setSaving(false); }
  }

  return { mode, scheme, ready, saving, error, clearError: () => setError(""), toggle };
}
