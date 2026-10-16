import { createRef, useState } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationNavigator } from "./ConversationNavigator";
import { conversationOutline } from "./conversation-outline";
import { emptyPresentation } from "./presentation";
import type { ChatSnapshot, NativeAnswer } from "./types";
import type { TreeCard, TreeLive } from "./tree-types";
import type { useConversationTree } from "./useConversationTree";

function fixtures() {
  const answer = (id: string, question: string): NativeAnswer => ({ id, question, text: "Native answer", stableId: true, element: document.createElement("article"), contentElement: document.createElement("div") });
  const snapshot: ChatSnapshot = { route: "/c/main", url: "https://chatgpt.com/c/main", conversationKey: "chatgpt:main", title: "Transformer", answers: [answer("first", "推理总览"), answer("second", "训练和推理的区别")] };
  const card = (id: string, label: string, parentId?: string): TreeCard => ({ id, label, ...(parentId ? { parentId } : {}), rootKey: "chatgpt:main", sourceKey: parentId ? "chatgpt:cache" : "chatgpt:main", sourceUrl: "https://chatgpt.com/c/main", sourceMessageId: parentId ? "remote-answer" : "first", collapsed: true, draft: "", createdAt: "2026-10-17T00:00:00Z" });
  const cards = [card("cache", "KV Cache"), card("keys", "Key 和 Value", "cache")];
  const live: Record<string, TreeLive> = { keys: { phase: "ready", updatedAt: 0, turns: [{ id: "remote", question: "请沿用书签的类比", text: "父支线的解释", markdown: "父支线的解释" }] } };
  return { snapshot, cards, live, presentation: emptyPresentation() };
}

describe("conversation outline", () => {
  it("keeps the main line chronological and attaches nested references to their sources", () => {
    const { snapshot, presentation, cards, live } = fixtures();
    presentation.favorites = ["second"];
    const root = conversationOutline(snapshot, presentation, cards, live);
    expect(root.children.map((node) => node.answer?.id)).toEqual(["first", "second"]);
    expect(root.children[0].children[0].card?.id).toBe("cache");
    expect(root.children[0].children[0].children[0].card?.id).toBe("keys");
    expect(root.children[1].children).toHaveLength(0);
  });

  it("searches saved branch history while retaining the full ancestor path", () => {
    const { snapshot, presentation, cards, live } = fixtures();
    const root = conversationOutline(snapshot, presentation, cards, live, "书签");
    expect(root.children.map((node) => node.answer?.id)).toEqual(["first"]);
    expect(root.children[0].children[0].label).toBe("KV Cache");
    expect(root.children[0].children[0].children[0].label).toBe("Key 和 Value");
    expect(conversationOutline(snapshot, presentation, cards, live, "不存在的词").children).toHaveLength(0);
  });

  it("keeps saved branches reachable when their source is not loaded, and isolates other conversations", () => {
    const { snapshot, presentation, cards, live } = fixtures();
    snapshot.answers = snapshot.answers.slice(1);
    cards.push({ ...cards[0], id: "foreign", rootKey: "chatgpt:other" });
    const root = conversationOutline(snapshot, presentation, cards, live);
    const unloaded = root.children.find((node) => !node.answer)!;
    expect(unloaded.label).toBe("尚未加载的主线回答");
    expect(unloaded.children.map((node) => node.card?.id)).toEqual(["cache"]);
    expect(unloaded.children[0].children[0].card?.id).toBe("keys");
  });

  it("filters favorites without changing their order or losing their reference descendants", () => {
    const { snapshot, presentation, cards, live } = fixtures();
    presentation.favorites = ["second", "first"];
    expect(conversationOutline(snapshot, presentation, cards, live, "", true).children.map((node) => node.answer?.id)).toEqual(["first", "second"]);
    presentation.favorites = ["first"];
    const root = conversationOutline(snapshot, presentation, cards, live, "", true);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children[0].children).toHaveLength(1);
  });
});

function setup() {
  const data = fixtures();
  const tree: ReturnType<typeof useConversationTree> = { cards: data.cards, live: data.live, focusTarget: null, error: "", clearError: vi.fn(), dismiss: vi.fn(), create: vi.fn(), update: vi.fn(), send: vi.fn(), focus: vi.fn(), open: vi.fn(), resume: vi.fn() };
  const selectAnswer = vi.fn();
  const branch = vi.fn(async () => {});
  const mutate = vi.fn(async () => true);
  function Harness() {
    const [query, setQuery] = useState("");
    return <ConversationNavigator {...data} tree={tree} activeId={null} ready branching={false} query={query} setQuery={setQuery} searchInput={createRef()} selectAnswer={selectAnswer} branch={branch} mutate={mutate} />;
  }
  return { ...render(<Harness />), ...data, tree, selectAnswer, branch, mutate };
}

describe("conversation tree navigation", () => {
  it("folds descendants independently of native context and opens the selected floating card", () => {
    const ui = setup();
    const tree = ui.getByRole("tree", { name: "当前对话树" });
    const child = within(tree).getByRole("treeitem", { name: "Key 和 Value 1 轮" });
    expect(child).toHaveAttribute("aria-level", "4");
    fireEvent.click(ui.getByRole("button", { name: "折叠节点：KV Cache" }));
    expect(ui.queryByRole("button", { name: "Key 和 Value 1 轮" })).toBeNull();
    expect(ui.tree.focus).not.toHaveBeenCalled();
    expect(ui.tree.resume).not.toHaveBeenCalled();
    expect(ui.tree.send).not.toHaveBeenCalled();
    fireEvent.click(ui.getByRole("button", { name: "展开节点：KV Cache" }));
    fireEvent.click(ui.getByRole("button", { name: "Key 和 Value 1 轮" }));
    expect(ui.tree.focus).toHaveBeenCalledWith(ui.cards[1]);
    fireEvent.click(ui.getByRole("button", { name: "01 推理总览" }));
    expect(ui.selectAnswer).toHaveBeenCalledWith(ui.snapshot.answers[0]);
  });

  it("reveals matching descendants through folded ancestors, then restores the folded state", () => {
    const ui = setup();
    fireEvent.click(ui.getByRole("button", { name: "折叠节点：推理总览" }));
    fireEvent.change(ui.getByRole("textbox", { name: "搜索对话树" }), { target: { value: "书签" } });
    expect(ui.getByRole("button", { name: "Key 和 Value 1 轮" })).toBeTruthy();
    expect(ui.queryByRole("button", { name: "02 训练和推理的区别" })).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "清除搜索" }));
    expect(ui.queryByRole("button", { name: "Key 和 Value 1 轮" })).toBeNull();
    expect(ui.getByRole("button", { name: "展开节点：推理总览" })).toBeTruthy();
  });

  it("supports arrow-key navigation between ancestors and descendants without opening cards", () => {
    const ui = setup();
    const main = ui.getByRole("button", { name: "主线 2 轮 · 2 支线" });
    main.focus();
    fireEvent.keyDown(main, { key: "ArrowRight" });
    expect(ui.getByRole("button", { name: "01 推理总览" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(ui.getByRole("button", { name: "KV Cache 未提问" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(ui.getByRole("button", { name: "Key 和 Value 1 轮" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(ui.getByRole("button", { name: "KV Cache 未提问" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(ui.getByRole("button", { name: "02 训练和推理的区别" })).toHaveFocus();
    expect(ui.tree.focus).not.toHaveBeenCalled();
  });

  it("retains pinning, renaming, and creating a branch from a main answer", async () => {
    const ui = setup();
    fireEvent.click(ui.getByRole("button", { name: "置顶回答 1" }));
    expect(ui.mutate).toHaveBeenCalledWith({ type: "favorite", messageId: "first", favorite: true });
    fireEvent.click(ui.getByRole("button", { name: "重命名回答 1 的卡片" }));
    fireEvent.change(ui.getByRole("textbox", { name: "卡片标题" }), { target: { value: "主线概览" } });
    fireEvent.click(ui.getByRole("button", { name: "保存卡片标题" }));
    await waitFor(() => expect(ui.queryByRole("textbox", { name: "卡片标题" })).toBeNull());
    expect(ui.mutate).toHaveBeenCalledWith({ type: "title", messageId: "first", title: "主线概览" });
    fireEvent.click(ui.getAllByRole("button", { name: "就地追问" })[1]);
    expect(ui.branch).toHaveBeenCalledWith(ui.snapshot.answers[1]);
  });
});
