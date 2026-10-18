import { useEffect, useState } from "react";
import { platform } from "./platform";

export const THEME_KEY = "lattice:theme:v1";
export const THEME_OPTIONS = [
  { value: "lattice", label: "Lattice 主题" },
  { value: "native-light", label: "ChatGPT 原生浅色" },
  { value: "native-dark", label: "ChatGPT 原生深色" },
  { value: "system", label: "跟随系统" }
] as const;
type Theme = typeof THEME_OPTIONS[number]["value"];
type Scheme = "light" | "dark";
// The previous native preference becomes the adaptive native palette.
const readTheme = (value: unknown): Theme => value === "native" ? "system" : THEME_OPTIONS.find((option) => option.value === value)?.value ?? "lattice";
const systemScheme = (): Scheme => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

export function useTheme() {
  const [mode, setMode] = useState<Theme>("lattice");
  const [system, setSystem] = useState(systemScheme);
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
    if (mode !== "system") return;
    // Only observe OS appearance; ChatGPT's own override remains independent.
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener?.("change", update);
    update();
    return () => { media.removeEventListener?.("change", update); };
  }, [mode]);

  async function select(value: string) {
    if (!ready || saving) return;
    const next = readTheme(value);
    if (next === mode) return;
    setSaving(true);
    setMode(next);
    try { await platform().storage.local.set({ [THEME_KEY]: next }); setError(""); }
    catch { setMode(mode); setError("主题偏好保存失败，请重试。"); }
    finally { setSaving(false); }
  }

  const scheme: Scheme = mode === "system" ? system : mode === "native-light" ? "light" : "dark";
  return { mode, scheme, ready, saving, error, clearError: () => setError(""), select };
}
