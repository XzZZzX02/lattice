import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LatticeApp } from "./App";
import { DEFAULT_PANEL_WIDTH, PANEL_WIDTH_KEY, panelLayout, readPanelWidth } from "./panel-layout";
import type { ExtensionPlatform } from "./platform";
import { usePanelLayout } from "./usePanelLayout";

let values: Record<string, unknown>;
const storage = {
  get: vi.fn(async (key: string | string[] | null) => Object.fromEntries((typeof key === "string" ? [key] : key ?? Object.keys(values)).map((name) => [name, values[name]]))),
  set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
  remove: vi.fn(async () => {})
};

function viewport(width: number) {
  act(() => { vi.stubGlobal("innerWidth", width); window.dispatchEvent(new Event("resize")); });
}

beforeEach(() => {
  values = {};
  vi.clearAllMocks();
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("chrome", {
    storage: { local: storage, session: storage, onChanged: { addListener() {}, removeListener() {} } },
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) }
  } satisfies Pick<ExtensionPlatform, "storage" | "runtime">);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("responsive sidebar layout", () => {
  it("reserves native conversation space even when expanded or manually widened", () => {
    for (const left of [0, 205, 260]) {
      for (const viewportWidth of [320, 640, 899, 900, 980, 1024, 1180, 1440, 1920]) {
        const layout = panelLayout(viewportWidth, left, 820, true);
        expect(layout.width).toBeLessThanOrEqual(viewportWidth - 16);
        if (!layout.compact) expect(viewportWidth - left - layout.width - 24).toBeGreaterThanOrEqual(480);
      }
    }
    expect(panelLayout(1180, 260, 340).compact).toBe(false);
    expect(panelLayout(1024, 260, 340).compact).toBe(true);
    expect(readPanelWidth("500")).toBeNull();
    expect(readPanelWidth(NaN)).toBeNull();
    expect(readPanelWidth(Infinity)).toBeNull();
    expect(readPanelWidth(-10)).toBe(280);
    expect(readPanelWidth(10000)).toBe(820);
  });

  it("clamps a saved width as the window shrinks and restores it on growing", async () => {
    values[PANEL_WIDTH_KEY] = 600;
    const { result, unmount } = renderHook(usePanelLayout);
    await waitFor(() => expect(result.current.width).toBe(600));
    viewport(1000);
    expect(result.current.width).toBe(420);
    expect(result.current.open).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--lattice-panel-width")).toBe("420px");
    viewport(390);
    expect(result.current.open).toBe(false);
    expect(document.documentElement.dataset.latticeLayout).toBe("closed");
    act(() => result.current.setOpen(true));
    expect(result.current.width).toBe(374);
    expect(document.documentElement.dataset.latticeLayout).toBe("overlay");
    viewport(1440);
    expect(result.current.width).toBe(600);
    expect(result.current.open).toBe(true);
    viewport(390);
    expect(result.current.open).toBe(false);
    expect(values[PANEL_WIDTH_KEY]).toBe(600);
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-lattice-layout");
    expect(document.documentElement.style.getPropertyValue("--lattice-panel-width")).toBe("");
  });

  it("keeps a manually closed desktop panel closed across viewport changes", () => {
    const { result } = renderHook(usePanelLayout);
    act(() => result.current.setOpen(false));
    viewport(390);
    act(() => result.current.setOpen(true));
    viewport(1440);
    expect(result.current.open).toBe(false);
  });

  it("accounts for the page scrollbar and ignores cached inactive pages", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(375);
    document.body.innerHTML = '<section data-app-shell-active-page="false"><main></main></section><section data-app-shell-active-page="true"><main></main></section>';
    const mains = document.querySelectorAll("main");
    vi.spyOn(mains[0], "getBoundingClientRect").mockReturnValue({ left: 500 } as DOMRect);
    vi.spyOn(mains[1], "getBoundingClientRect").mockReturnValue({ left: 0 } as DOMRect);
    try {
      const { result } = renderHook(usePanelLayout);
      act(() => result.current.setOpen(true));
      act(() => result.current.setWide(true));
      expect(result.current.width).toBe(359);
      expect(result.current.compact).toBe(true);
    } finally { cleanup(); document.body.innerHTML = ""; }
  });

  it("releases native layout spacing while a native overlay is visible", () => {
    const { result, rerender } = renderHook(({ hidden }) => usePanelLayout(hidden), { initialProps: { hidden: false } });
    expect(document.documentElement.dataset.latticeLayout).toBe("docked");
    rerender({ hidden: true });
    expect(result.current.visible).toBe(false);
    expect(document.documentElement.dataset.latticeOpen).toBe("false");
    expect(document.documentElement.dataset.latticeLayout).toBe("closed");
    rerender({ hidden: false });
    expect(document.documentElement.dataset.latticeLayout).toBe("docked");
  });

  it("drags the left edge, persists only the completed gesture, and restores the preference", async () => {
    const ui = render(<LatticeApp getHref={() => "https://chatgpt.com/"} />);
    const handle = ui.getByRole("separator", { name: "调整侧边栏宽度" });
    expect(handle).toHaveAttribute("aria-valuenow", "340");
    fireEvent.pointerDown(handle, { button: 0, clientX: 1100 });
    fireEvent.pointerMove(handle, { clientX: 1000 });
    expect(handle).toHaveAttribute("aria-valuenow", "440");
    expect(storage.set).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle);
    await waitFor(() => expect(values[PANEL_WIDTH_KEY]).toBe(440));
    ui.unmount();
    const remounted = renderHook(usePanelLayout);
    await waitFor(() => expect(remounted.result.current.width).toBe(440));
  });

  it("supports keyboard resizing, bounds, expanded width, and double-click reset", async () => {
    const ui = render(<LatticeApp getHref={() => "https://chatgpt.com/"} />);
    const handle = ui.getByRole("separator", { name: "调整侧边栏宽度" });
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(handle).toHaveAttribute("aria-valuenow", "380");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "280");
    fireEvent.click(ui.getByRole("button", { name: "展开工作区" }));
    expect(handle).toHaveAttribute("aria-valuenow", "604");
    expect(document.documentElement.style.getPropertyValue("--lattice-panel-width")).toBe("604px");
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_PANEL_WIDTH));
    await waitFor(() => expect(values[PANEL_WIDTH_KEY]).toBe(DEFAULT_PANEL_WIDTH));
  });

  it("starts collapsed on a narrow page and dismisses the drawer on returning to native chat", async () => {
    viewport(320);
    const main = document.createElement("main");
    const composer = document.createElement("textarea");
    main.append(composer);
    document.body.append(main);
    try {
      const ui = render(<LatticeApp getHref={() => "https://chatgpt.com/"} />);
      expect(ui.queryByRole("complementary")).toBeNull();
      fireEvent.click(ui.getByRole("button", { name: "打开 Lattice" }));
      expect(ui.getByRole("separator")).toHaveAttribute("aria-valuenow", "304");
      fireEvent.pointerDown(ui.getByRole("navigation", { name: "工作区视图" }));
      expect(ui.getByRole("complementary")).toBeInTheDocument();
      fireEvent.pointerDown(composer);
      expect(ui.queryByRole("complementary")).toBeNull();
      fireEvent.click(ui.getByRole("button", { name: "打开 Lattice" }));
      fireEvent.focusIn(composer);
      expect(ui.queryByRole("complementary")).toBeNull();
      fireEvent.click(ui.getByRole("button", { name: "打开 Lattice" }));
      fireEvent.keyDown(ui.getByRole("complementary"), { key: "Escape" });
      expect(ui.queryByRole("complementary")).toBeNull();
      expect(ui.getByRole("button", { name: "打开 Lattice" })).toHaveFocus();
    } finally { main.remove(); }
  });

  it("keeps a manual resize when a stale saved width finishes loading", async () => {
    let resolve!: (values: Record<string, unknown>) => void;
    storage.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(usePanelLayout);
    act(() => result.current.resizeProps.onDoubleClick());
    await act(async () => resolve({ [PANEL_WIDTH_KEY]: 600 }));
    expect(result.current.width).toBe(DEFAULT_PANEL_WIDTH);
  });
});
