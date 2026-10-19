import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionPlatform, StorageArea } from "./platform";
import type { BranchLink, ExtensionMessage, ExtensionResponse, PendingBranch, Presentation } from "./types";
import { BRANCHES_KEY, BRANCH_TTL, presentationKey } from "./presentation";
import { TREE_KEY, WORKERS_KEY } from "./tree-types";

type MessageListener = Parameters<ExtensionPlatform["runtime"]["onMessage"]["addListener"]>[0];
type TabListener = Parameters<ExtensionPlatform["tabs"]["onCreated"]["addListener"]>[0];
let local: Record<string, unknown>;
let session: Record<string, unknown>;
let handlers: { message?: MessageListener; created?: TabListener };
const source = "https://chatgpt.com/c/source";

function area(values: Record<string, unknown>): StorageArea {
  return {
    get: async (keys) => structuredClone(Object.fromEntries((keys === null ? Object.keys(values) : typeof keys === "string" ? [keys] : keys).map((key) => [key, values[key]]))),
    set: async (items) => { Object.assign(values, structuredClone(items)); },
    remove: async (keys) => { for (const key of typeof keys === "string" ? [keys] : keys) delete values[key]; }
  };
}
beforeEach(async () => {
  local = {}; session = {}; handlers = {};
  const api: ExtensionPlatform = {
    storage: { local: area(local), session: area(session), onChanged: { addListener() {}, removeListener() {} } },
    runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener: (listener) => { handlers.message = listener; } } },
    tabs: { onCreated: { addListener: (listener) => { handlers.created = listener; } } }
  };
  vi.stubGlobal("chrome", api);
  vi.resetModules();
  await import("./background");
});
afterEach(() => { vi.unstubAllGlobals(); });
function send(message: ExtensionMessage, tabId = 1, url = source): Promise<ExtensionResponse> {
  return new Promise((resolve) => { handlers.message!(message, { tab: { id: tabId }, url }, resolve); });
}
async function arm() {
  return send({ type: "branch:arm", key: "chatgpt:source", url: source, messageId: "message:a", title: "Source" });
}

describe("extension background coordination", () => {
  it("keeps persistence responsive while a native surface is waiting on another tab", async () => {
    const native = { id: 'message:ui', question: 'Lab', text: '[原生交互内容]', markdown: '', content: [{ type: 'native', index: 0, label: 'Lab' }] };
    local[TREE_KEY] = [{ id: 'card', rootKey: 'chatgpt:source', sourceKey: 'chatgpt:source', sourceUrl: source, sourceMessageId: 'message:a', targetKey: 'chatgpt:branch' }];
    session[WORKERS_KEY] = [{ cardId: 'card', tabId: 2, ownerTabId: 1, lastKey: 'chatgpt:branch', live: { phase: 'ready', turns: [native], updatedAt: 0 } }];
    let release!: (value: ExtensionResponse) => void;
    const forward = vi.fn(() => new Promise<ExtensionResponse>((resolve) => { release = resolve; }));
    (globalThis as typeof globalThis & { chrome: ExtensionPlatform }).chrome.tabs.sendMessage = forward;
    const pending = send({ type: 'tree:surface', rootKey: 'chatgpt:source', pageUrl: source, id: 'card', messageId: native.id, index: 0 });
    await vi.waitFor(() => expect(forward).toHaveBeenCalledOnce());
    const saved = await send({ type: 'presentation:mutate', key: 'chatgpt:source', mutation: { type: 'favorite', messageId: 'a', favorite: true } });
    expect(saved.ok).toBe(true);
    release({ ok: true });
    expect((await pending).ok).toBe(true);
  });
  it("serializes changes from two tabs to avoid losing organization", async () => {
    await Promise.all([
      send({ type: "presentation:mutate", key: "chatgpt:source", mutation: { type: "favorite", messageId: "a", favorite: true } }, 1),
      send({ type: "presentation:mutate", key: "chatgpt:source", mutation: { type: "favorite", messageId: "b", favorite: true } }, 2)
    ]);
    expect((local[presentationKey("chatgpt:source")] as Presentation).favorites).toEqual(["a", "b"]);
  });
  it("links a native branch opened in a child tab and retains the exact source anchor", async () => {
    await arm();
    handlers.created!({ id: 2, openerTabId: 1 });
    const url = "https://chatgpt.com/c/child";
    await send({ type: "conversation:ready", key: "chatgpt:child", url, title: "Child" }, 2, url);
    const links = local[BRANCHES_KEY] as BranchLink[];
    expect(links).toHaveLength(1);
    expect(links[0].sourceUrl).toBe(`${source}#lattice-message=message%3Aa`);
    expect(links[0].targetKey).toBe("chatgpt:child");
    expect(session["lattice:pending:1"]).toBeUndefined();
    expect(session["lattice:opener:2"]).toBeUndefined();
  });
  it("also records a native branch that opens in the source tab", async () => {
    await arm();
    const url = "https://chatgpt.com/c/same-tab-child";
    await send({ type: "conversation:ready", key: "chatgpt:same-tab-child", url, title: "Child" }, 1, url);
    expect((local[BRANCHES_KEY] as BranchLink[])[0].targetKey).toBe("chatgpt:same-tab-child");
  });
  it("does not record unrelated browsing or late navigation as a branch", async () => {
    handlers.created!({ id: 8, openerTabId: 7 });
    const other = "https://chatgpt.com/c/other";
    await send({ type: "conversation:ready", key: "chatgpt:other", url: other, title: "Other" }, 8, other);
    expect(session["lattice:opener:8"]).toBeUndefined();
    expect(local[BRANCHES_KEY]).toBeUndefined();
    await arm();
    (session["lattice:pending:1"] as PendingBranch).createdAt -= BRANCH_TTL + 10;
    await send({ type: "conversation:ready", key: "chatgpt:other", url: other, title: "Late" }, 1, other);
    expect(local[BRANCHES_KEY]).toBeUndefined();
    expect(session["lattice:pending:1"]).toBeUndefined();
  });
  it("rejects a stale edit after the tab has switched conversations", async () => {
    const response = await send({ type: "presentation:mutate", key: "chatgpt:source", mutation: { type: "title", messageId: "a", title: "Stale edit" } }, 1, "https://chatgpt.com/c/other");
    expect(response.ok).toBe(false);
    expect(local).toEqual({});
  });
  it("cancels pending branch linkage when a native action fails", async () => {
    const response = await arm();
    expect(response.ok).toBe(true);
    if (response.ok) await send({ type: "branch:cancel", token: response.token! });
    expect(session["lattice:pending:1"]).toBeUndefined();
  });
  it("allows explicit linkage for native branches opened without an opener tab", async () => {
    const message = { type: "branch:link" as const, sourceKey: "chatgpt:source", sourceUrl: source, sourceMessageId: "message:a", sourceTitle: "Source", targetUrl: "https://chatgpt.com/c/manually-created", targetTitle: "Existing native branch" };
    expect((await send(message)).ok).toBe(true);
    const links = local[BRANCHES_KEY] as BranchLink[];
    expect(links[0].manual).toBe(true);
    expect((await send(message)).ok).toBe(false);
  });
  it("does not let manual branch links point outside ChatGPT", async () => {
    expect((await send({ type: "branch:link", sourceKey: "chatgpt:source", sourceUrl: source, sourceMessageId: "message:a", sourceTitle: "Source", targetUrl: "https://example.com/c/target", targetTitle: "Wrong site" })).ok).toBe(false);
    expect(local[BRANCHES_KEY]).toBeUndefined();
  });
});
