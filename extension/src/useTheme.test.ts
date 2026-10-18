import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY, THEME_OPTIONS, useTheme } from "./useTheme";
import type { ExtensionPlatform } from "./platform";

type Listener = Parameters<ExtensionPlatform["storage"]["onChanged"]["addListener"]>[0];
const listeners = new Set<Listener>();
let values: Record<string, unknown>;
let darkOS = false;
const mediaListeners = new Set<() => void>();
const area = {
  get: vi.fn(async (key: string | string[] | null) => Object.fromEntries((typeof key === "string" ? [key] : key ?? Object.keys(values)).map((name) => [name, values[name]]))),
  set: vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(values, items);
    for (const listener of listeners) listener(Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }])), "local");
  }),
  remove: vi.fn(async () => {})
};

beforeEach(() => {
  values = {};
  darkOS = false;
  listeners.clear();
  mediaListeners.clear();
  vi.clearAllMocks();
  document.documentElement.className = "light";
  vi.stubGlobal("matchMedia", () => ({ get matches() { return darkOS; }, addEventListener: (_: string, listener: () => void) => { mediaListeners.add(listener); }, removeEventListener: (_: string, listener: () => void) => { mediaListeners.delete(listener); } }));
  vi.stubGlobal("chrome", { storage: { local: area, session: area, onChanged: { addListener: (listener: Listener) => { listeners.add(listener); }, removeListener: (listener: Listener) => { listeners.delete(listener); } } } } satisfies Pick<ExtensionPlatform, "storage">);
});
afterEach(() => { cleanup(); document.documentElement.removeAttribute("class"); vi.unstubAllGlobals(); });

describe("workspace theme preference", () => {
  it("keeps the existing default and restores every dropdown choice after remount", async () => {
    let hook = renderHook(useTheme);
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.mode).toBe("lattice");
    for (const { value } of [...THEME_OPTIONS.slice(1), THEME_OPTIONS[0]]) {
      await act(() => hook.result.current.select(value));
      expect(values[THEME_KEY]).toBe(value);
      hook.unmount();
      expect(listeners.size).toBe(0);
      expect(mediaListeners.size).toBe(0);
      hook = renderHook(useTheme);
      await waitFor(() => expect(hook.result.current.ready).toBe(true));
      expect(hook.result.current.mode).toBe(value);
    }
  });

  it("keeps explicit light and dark independent of both the page and OS appearance", async () => {
    values[THEME_KEY] = "native-dark";
    const { result } = renderHook(useTheme);
    await waitFor(() => expect(result.current.mode).toBe("native-dark"));
    expect(document.documentElement.className).toBe("light");
    expect(result.current.scheme).toBe("dark");
    await act(async () => { document.documentElement.className = "dark"; darkOS = true; });
    await act(() => result.current.select("native-light"));
    expect(result.current.scheme).toBe("light");
    expect(mediaListeners.size).toBe(0);
  });

  it("follows OS changes even when ChatGPT uses the opposite appearance and removes its listener", async () => {
    values[THEME_KEY] = "system";
    document.documentElement.className = "dark";
    const { result } = renderHook(useTheme);
    await waitFor(() => expect(result.current.mode).toBe("system"));
    expect(result.current.scheme).toBe("light");
    expect(mediaListeners.size).toBe(1);
    await act(async () => {
      document.documentElement.className = "light";
      darkOS = true;
      for (const listener of mediaListeners) listener();
    });
    expect(result.current.scheme).toBe("dark");
    await act(async () => { darkOS = false; for (const listener of mediaListeners) listener(); });
    expect(result.current.scheme).toBe("light");
    await act(() => result.current.select("native-dark"));
    expect(mediaListeners.size).toBe(0);
    await act(async () => { darkOS = true; });
    await act(() => result.current.select("system"));
    expect(result.current.scheme).toBe("dark");
  });

  it("maps the previous native preference to system and falls back safely for unknown preferences", async () => {
    values[THEME_KEY] = "native";
    const { result } = renderHook(useTheme);
    await waitFor(() => expect(result.current.mode).toBe("system"));
    await act(async () => {
      for (const listener of listeners) listener({ [THEME_KEY]: { newValue: "unsupported" } }, "local");
    });
    expect(result.current.mode).toBe("lattice");
  });

  it("uses a newer preference from another tab instead of a stale initial read", async () => {
    let resolve!: (values: Record<string, unknown>) => void;
    area.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useTheme);
    await act(async () => {
      for (const listener of listeners) listener({ [THEME_KEY]: { newValue: "native-dark" } }, "local");
      resolve({ [THEME_KEY]: "lattice" });
    });
    expect(result.current.mode).toBe("native-dark");
    expect(result.current.ready).toBe(true);
  });

  it("rolls back a failed save and allows retry without touching conversation data", async () => {
    const { result } = renderHook(useTheme);
    await waitFor(() => expect(result.current.ready).toBe(true));
    area.set.mockRejectedValueOnce(new Error("Storage unavailable"));
    await act(() => result.current.select("native-light"));
    expect(result.current.mode).toBe("lattice");
    expect(result.current.error).toContain("保存失败");
    await act(() => result.current.select("native-light"));
    expect(result.current.mode).toBe("native-light");
    expect(result.current.error).toBe("");
    expect(area.set).toHaveBeenLastCalledWith({ [THEME_KEY]: "native-light" });
    expect(Object.keys(values)).toEqual([THEME_KEY]);
  });
});
