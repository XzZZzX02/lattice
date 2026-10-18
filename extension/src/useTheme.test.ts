import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY, useTheme } from "./useTheme";
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
  vi.stubGlobal("matchMedia", () => ({ matches: darkOS, addEventListener: (_: string, listener: () => void) => { mediaListeners.add(listener); }, removeEventListener: (_: string, listener: () => void) => { mediaListeners.delete(listener); } }));
  vi.stubGlobal("chrome", { storage: { local: area, session: area, onChanged: { addListener: (listener: Listener) => { listeners.add(listener); }, removeListener: (listener: Listener) => { listeners.delete(listener); } } } } satisfies Pick<ExtensionPlatform, "storage">);
});
afterEach(() => { cleanup(); document.documentElement.removeAttribute("class"); vi.unstubAllGlobals(); });

describe("workspace theme preference", () => {
  it("keeps the existing default, persists both choices and restores after remount", async () => {
    const first = renderHook(useTheme);
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    expect(first.result.current.mode).toBe("lattice");
    await act(() => first.result.current.toggle());
    expect(values[THEME_KEY]).toBe("native");
    first.unmount();
    const second = renderHook(useTheme);
    await waitFor(() => expect(second.result.current.mode).toBe("native"));
    await act(() => second.result.current.toggle());
    expect(values[THEME_KEY]).toBe("lattice");
    second.unmount();
    expect(listeners.size).toBe(0);
    expect(mediaListeners.size).toBe(0);
  });

  it("follows the explicit ChatGPT appearance and then system changes when no override exists", async () => {
    values[THEME_KEY] = "native";
    const { result } = renderHook(useTheme);
    await waitFor(() => expect(result.current.mode).toBe("native"));
    expect(result.current.scheme).toBe("light");
    await act(async () => { document.documentElement.className = "dark"; });
    expect(result.current.scheme).toBe("dark");
    await act(async () => { document.documentElement.className = "light"; });
    expect(result.current.scheme).toBe("light");
    await act(async () => {
      document.documentElement.className = "";
      darkOS = true;
      for (const listener of mediaListeners) listener();
    });
    expect(result.current.scheme).toBe("dark");
    await act(() => result.current.toggle());
    expect(result.current.mode).toBe("lattice");
    expect(mediaListeners.size).toBe(0);
  });

  it("uses a newer preference from another tab instead of a stale initial read", async () => {
    let resolve!: (values: Record<string, unknown>) => void;
    area.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(useTheme);
    await act(async () => {
      for (const listener of listeners) listener({ [THEME_KEY]: { newValue: "native" } }, "local");
      resolve({ [THEME_KEY]: "lattice" });
    });
    expect(result.current.mode).toBe("native");
    expect(result.current.ready).toBe(true);
  });

  it("rolls back a failed save and allows retry without touching conversation data", async () => {
    const { result } = renderHook(useTheme);
    await waitFor(() => expect(result.current.ready).toBe(true));
    area.set.mockRejectedValueOnce(new Error("Storage unavailable"));
    await act(() => result.current.toggle());
    expect(result.current.mode).toBe("lattice");
    expect(result.current.error).toContain("保存失败");
    await act(() => result.current.toggle());
    expect(result.current.mode).toBe("native");
    expect(result.current.error).toBe("");
    expect(area.set).toHaveBeenLastCalledWith({ [THEME_KEY]: "native" });
    expect(Object.keys(values)).toEqual([THEME_KEY]);
  });
});
