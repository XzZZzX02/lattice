import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { LatticeApp } from "./App";
import { createTreeCoordinator } from "./tree-background";
import { TREE_KEY, type NativeReport, type TreeCard } from "./tree-types";
import type { ExtensionPlatform, StorageArea } from "./platform";
import type { ExtensionMessage } from "./types";
const url = "https://chatgpt.com/c/main";
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });
describe("inline conversation cards", () => {
  it("keeps the main answer and composer while sending, collapsing, reopening and growing a child", async () => {
    const local: Record<string, unknown> = {};
    const session: Record<string, unknown> = {};
    const listeners = new Set<Parameters<ExtensionPlatform["storage"]["onChanged"]["addListener"]>[0]>();
    function area(data: Record<string, unknown>): StorageArea {
      return { get: async (keys) => structuredClone(Object.fromEntries((keys === null ? Object.keys(data) : typeof keys === "string" ? [keys] : keys).map((key) => [key, data[key]]))), set: async (items) => { Object.assign(data, structuredClone(items)); if (data === local) for (const listener of listeners) listener(Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }])), "local"); }, remove: async () => {} };
    }
    const api: ExtensionPlatform = { storage: { local: area(local), session: area(session), onChanged: { addListener: (listener) => { listeners.add(listener); }, removeListener: (listener) => { listeners.delete(listener); } } }, runtime: { onMessage: { addListener() {} }, sendMessage: async (message: ExtensionMessage) => message.type.startsWith("tree:") ? tree.handle(message as Parameters<typeof tree.handle>[0], 1) : { ok: true } }, tabs: { onCreated: { addListener() {} }, create: async () => ({ id: 10 }), get: async (id) => ({ id }) } };
    const tree = createTreeCoordinator(api);
    vi.stubGlobal("chrome", api);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    document.body.innerHTML = '<main><div data-message-author-role="user" data-message-id="u">Explain Transformer</div><article><div data-message-author-role="assistant" data-message-id="a"><p>KV Cache is mentioned here.</p><a href="https://example.org">Native citation</a></div></article><textarea id="main-composer"></textarea></main>';
    const answer = document.querySelector("[data-message-id='a']")!;
    const originalHtml = answer.innerHTML;
    const composer = document.getElementById("main-composer");
    const rendered = render(<LatticeApp getHref={() => url} />);
    fireEvent.click(await rendered.findByRole("button", { name: "就地追问" }));
    await waitFor(() => expect(document.querySelector("[data-lattice-tree-host]")?.shadowRoot?.querySelector("textarea")).toBeTruthy());
    const shadow = document.querySelector("[data-lattice-tree-host]")!.shadowRoot!;
    const ui = () => within(shadow.querySelector(".inline-tree") as HTMLElement);
    fireEvent.change(ui().getByRole("textbox"), { target: { value: "What does it cache?" } });
    fireEvent.submit(shadow.querySelector("form")!);
    await waitFor(() => expect(ui().getByRole("textbox")).toBeDisabled());
    const report: NativeReport = { url, key: "chatgpt:main", title: "Main", generating: false, composerReady: true, answers: [{ id: "message:a", question: "Explain Transformer", text: "KV Cache", markdown: "KV Cache" }] };
    await act(async () => {
      const fork = await tree.handle({ type: "native:report", report }, 10);
      await tree.handle({ type: "native:ack", commandId: fork.ok ? fork.command!.id : "" }, 10);
      const send = await tree.handle({ type: "native:report", report: { ...report, url: "https://chatgpt.com/c/branch", key: "chatgpt:branch" } }, 10);
      await tree.handle({ type: "native:ack", commandId: send.ok ? send.command!.id : "" }, 10);
      await tree.handle({ type: "native:report", report: { ...report, url: "https://chatgpt.com/c/branch", key: "chatgpt:branch", answers: [...report.answers, { id: "message:b", question: "What does it cache?", text: "Keys and values, like a bookmark.", markdown: "Keys and values, like a **bookmark**." }] } }, 10);
    });
    await waitFor(() => expect(ui().getByText("bookmark")).toBeTruthy(), { timeout: 2500 });
    fireEvent.click(ui().getByRole("button", { name: "收起支线：关于这条回答" }));
    await waitFor(() => expect(ui().queryByRole("textbox")).toBeNull());
    fireEvent.click(ui().getByRole("button", { name: "展开支线：关于这条回答" }));
    await waitFor(() => expect(ui().getByText("bookmark")).toBeTruthy());
    fireEvent.click(ui().getByRole("button", { name: "从这条回答展开子支线" }));
    await waitFor(() => expect((local[TREE_KEY] as TreeCard[])).toHaveLength(2));
    expect((local[TREE_KEY] as TreeCard[])[1]).toMatchObject({ parentId: (local[TREE_KEY] as TreeCard[])[0].id, sourceKey: "chatgpt:branch", sourceMessageId: "message:b" });
    fireEvent.click(rendered.container.querySelectorAll(".tree-outline-link")[1]);
    await waitFor(() => expect(vi.mocked(HTMLElement.prototype.scrollIntoView).mock.instances.some((element) => (element as HTMLElement).dataset.treeCardId === (local[TREE_KEY] as TreeCard[])[1].id)).toBe(true));
    expect(answer.innerHTML).toBe(originalHtml);
    expect(document.getElementById("main-composer")).toBe(composer);
    expect((composer as HTMLTextAreaElement).value).toBe("");
    rendered.unmount();
    expect(document.querySelector("[data-lattice-tree-host]")).toBeNull();
  });
});
