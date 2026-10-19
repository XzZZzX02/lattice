import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTreeCoordinator } from "./tree-background";
import type { ExtensionPlatform, StorageArea } from "./platform";
import { TREE_KEY, WORKERS_KEY, type NativeReport, type TreeCard } from "./tree-types";

const source = "https://chatgpt.com/c/main";
const root = { rootKey: "chatgpt:main", pageUrl: source };
const turn = { id: "message:a", question: "Main question", text: "Self attention", markdown: "Self attention" };
let values: Record<string, unknown>;
let temporary: Record<string, unknown>;
let opened: { url: string; active: boolean }[];
let tree: ReturnType<typeof createTreeCoordinator>;
let api: ExtensionPlatform;
function area(data: Record<string, unknown>): StorageArea {
  return { get: async (keys) => structuredClone(Object.fromEntries((keys === null ? Object.keys(data) : typeof keys === "string" ? [keys] : keys).map((key) => [key, data[key]]))), set: async (items) => { Object.assign(data, structuredClone(items)); }, remove: async (keys) => { for (const key of typeof keys === "string" ? [keys] : keys) delete data[key]; } };
}
beforeEach(() => {
  values = {}; temporary = {}; opened = [];
  api = { storage: { local: area(values), session: area(temporary), onChanged: { addListener() {}, removeListener() {} } }, runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) }, tabs: { onCreated: { addListener() {} }, create: async (properties) => { opened.push(properties); return { id: opened.length + 10 }; }, get: async (id) => ({ id }), update: async (id) => ({ id }) } };
  tree = createTreeCoordinator(api);
});
async function create(parentId?: string, sourceKey = root.rootKey, sourceUrl = source, messageId = turn.id) {
  const result = await tree.handle({ type: "tree:create", ...root, sourceKey, sourceUrl, messageId, label: "Self attention", ...(parentId ? { parentId } : {}) }, 1);
  if (!result.ok) throw new Error(result.error);
  return result.cardId!;
}
function report(url = source, answers = [turn]): NativeReport { return { url, key: `chatgpt:${url.split("/").at(-1)}`, title: "Native", answers, generating: false, composerReady: true }; }
async function ready(id: string) {
  await tree.handle({ type: "tree:send", ...root, id, text: "What is it?" }, 1);
  const fork = await tree.handle({ type: "native:report", report: report() }, 11);
  expect(fork.ok && fork.command?.type).toBe("fork");
  await tree.handle({ type: "native:ack", commandId: fork.ok ? fork.command!.id : "" }, 11);
  const target = "https://chatgpt.com/c/branch";
  const send = await tree.handle({ type: "native:report", report: report(target) }, 11);
  expect(send.ok && send.command?.key).toBe("chatgpt:branch");
  await tree.handle({ type: "native:ack", commandId: send.ok ? send.command!.id : "" }, 11);
  await tree.handle({ type: "native:report", report: report(target, [turn, { id: "message:b", question: "What is it?", text: "A branch answer", markdown: "A branch answer" }]) }, 11);
}
describe("context-bearing conversation tree", () => {
  it("creates a local inline draft without navigating or sending anything", async () => {
    const id = await create();
    expect(opened).toEqual([]);
    const cards = values[TREE_KEY] as TreeCard[];
    expect(cards[0]).toMatchObject({ id, rootKey: root.rootKey, sourceMessageId: turn.id, collapsed: false });
    expect(temporary[WORKERS_KEY]).toBeUndefined();
  });
  it("forks in an inactive native tab, excludes inherited turns, and never replays delivered prompts", async () => {
    const id = await create();
    await ready(id);
    expect(opened).toHaveLength(1);
    expect(opened[0].active).toBe(false);
    const snapshot = await tree.handle({ type: "tree:read", ...root }, 1);
    expect(snapshot.ok && snapshot.live?.[id].turns.map((item) => item.id)).toEqual(["message:b"]);
    expect(snapshot.ok && snapshot.live?.[id].phase).toBe("ready");
    tree = createTreeCoordinator(api); // Simulate an MV3 service worker restart.
    const repeat = await tree.handle({ type: "native:report", report: report("https://chatgpt.com/c/branch") }, 11);
    expect(repeat.ok && repeat.command).toBeUndefined();
  });
  it("retains the same native context after collapse and a second question", async () => {
    const id = await create();
    await ready(id);
    await tree.handle({ type: "tree:update", ...root, id, collapsed: true }, 1);
    await tree.handle({ type: "tree:update", ...root, id, collapsed: false }, 1);
    await tree.handle({ type: "tree:send", ...root, id, text: "Why?" }, 1);
    const next = await tree.handle({ type: "native:report", report: report("https://chatgpt.com/c/branch", [turn, { ...turn, id: "message:b" }]) }, 11);
    expect(next.ok && next.command).toMatchObject({ type: "send", key: "chatgpt:branch", text: "Why?" });
    expect(opened).toHaveLength(1);
    expect((values[TREE_KEY] as TreeCard[])[0].targetKey).toBe("chatgpt:branch");
  });
  it("pins sub-branches to a real answer in their own parent context", async () => {
    const id = await create();
    await ready(id);
    const child = await create(id, "chatgpt:branch", "https://chatgpt.com/c/branch", "message:b");
    expect((values[TREE_KEY] as TreeCard[]).find((item) => item.id === child)).toMatchObject({ parentId: id, sourceKey: "chatgpt:branch", sourceMessageId: "message:b" });
    const invalid = await tree.handle({ type: "tree:create", ...root, parentId: id, sourceKey: root.rootKey, sourceUrl: source, messageId: turn.id, label: "Wrong parent" }, 1);
    expect(invalid.ok).toBe(false);
  });
  it("sends in a native local fork once, then binds the real saved context without resending", async () => {
    const id = await create();
    await tree.handle({ type: "tree:send", ...root, id, text: "Local fork\nquestion" }, 1);
    const fork = await tree.handle({ type: "native:report", report: report() }, 11);
    await tree.handle({ type: "native:ack", commandId: fork.ok ? fork.command!.id : "" }, 11);
    const local = { ...report(), url: "https://chatgpt.com/c/local-chatgpt%3Atemporary", key: null };
    const first = await tree.handle({ type: "native:report", report: local }, 11);
    expect(first.ok && first.command).toMatchObject({ type: "send", route: local.url, text: "Local fork\nquestion" });
    await tree.handle({ type: "native:ack", commandId: first.ok ? first.command!.id : "" }, 11);
    const saved = await tree.handle({ type: "native:report", report: report("https://chatgpt.com/c/saved", [turn, { id: "message:b", question: "Local forkquestion", text: "Answer", markdown: "Answer" }]) }, 11);
    expect(saved.ok && saved.command).toBeUndefined();
    expect((values[TREE_KEY] as TreeCard[])[0].targetKey).toBe("chatgpt:saved");
    const snapshot = await tree.handle({ type: "tree:read", ...root }, 1);
    expect(snapshot.ok && snapshot.live?.[id].phase).toBe("ready");
  });
  it("rejects unrelated reports and stale main-line commands", async () => {
    expect(await tree.handle({ type: "native:report", report: report() }, 55)).toEqual({ ok: true, managed: false });
    expect((await tree.handle({ type: "tree:read", ...root, pageUrl: "https://chatgpt.com/c/other" }, 1)).ok).toBe(false);
  });
  it("clears old tasks on restore and remaps IDs that belong to another main line", async () => {
    const id = await create();
    await ready(id);
    const original = (values[TREE_KEY] as TreeCard[])[0];
    const foreign = { ...original, id: "foreign-card", rootKey: "chatgpt:other" };
    values[TREE_KEY] = [original, foreign];
    await tree.replace(root.rootKey, [{ ...original, id: foreign.id }]);
    const records = values[TREE_KEY] as TreeCard[];
    expect(records.find((card) => card.rootKey === root.rootKey)?.id).not.toBe(foreign.id);
    expect(records.find((card) => card.id === foreign.id)?.rootKey).toBe(foreign.rootKey);
    expect(await tree.handle({ type: "native:report", report: report("https://chatgpt.com/c/branch") }, 11)).toEqual({ ok: true, managed: false });
    await tree.replace(root.rootKey, []);
    expect(values[TREE_KEY]).toEqual([foreign]);
  });
  it("does not replay an acknowledged-lost send and does not accept parallel sends", async () => {
    const id = await create();
    await tree.handle({ type: "tree:send", ...root, id, text: "first" }, 1);
    await expect(tree.handle({ type: "tree:send", ...root, id, text: "second" }, 1)).rejects.toThrow("上一条");
    const fork = await tree.handle({ type: "native:report", report: report() }, 11);
    expect(fork.ok && fork.command?.type).toBe("fork");
    const again = await tree.handle({ type: "native:report", report: report() }, 11);
    expect(again.ok && again.command).toBeUndefined();
  });
});

describe('native surface routing', () => {
  it('binds actions to a real answer in the correct branch without storing HTML', async () => {
    const id = await create(); await ready(id);
    const native = { id: 'message:ui', question: 'Native application', text: '[原生交互内容]', markdown: '', content: [{ type: 'native' as const, index: 0, label: 'Lab' }] };
    await tree.handle({ type: 'native:report', report: report('https://chatgpt.com/c/branch', [turn, native]) }, 11);
    const surface = { session: 's', revision: 1, html: '<button>Native control</button>', css: '', stylesheets: [], rootClass: '', dir: 'ltr', height: 200 };
    api.tabs.sendMessage = vi.fn(async () => ({ ok: true as const, surface }));
    const message = { type: 'tree:surface' as const, ...root, id, messageId: native.id, index: 0 };
    expect(await tree.handle(message, 1)).toEqual({ ok: true, surface });
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(11, expect.objectContaining({ type: 'native:surface', key: 'chatgpt:branch', messageId: native.id }), { frameId: 0 });
    expect((await tree.handle({ ...message, messageId: turn.id }, 1)).ok).toBe(false);
    expect((await tree.handle({ ...message, pageUrl: 'https://chatgpt.com/c/other' }, 1)).ok).toBe(false);
    expect(api.tabs.sendMessage).toHaveBeenCalledOnce();
    expect(JSON.stringify(temporary)).not.toContain('Native control');
  });
  it('recovers a closed native tab without replaying its prior prompt', async () => {
    const id = await create(); await ready(id);
    api.tabs.get = async () => { throw new Error('Closed tab'); };
    await tree.handle({ type: 'tree:resume', ...root, id }, 1);
    expect(opened).toHaveLength(2);
    expect(opened[1].url).toContain('/c/branch#lattice-worker=');
    const restored = await tree.handle({ type: 'native:report', report: report('https://chatgpt.com/c/branch', [turn, { ...turn, id: 'message:b' }]) }, 12);
    expect(restored.ok && restored.command).toBeUndefined();
  });
});
