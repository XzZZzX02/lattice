import type { ChatSnapshot, NativeAnswer, Presentation } from "./types";
import type { TreeCard, TreeLive } from "./tree-types";

export interface ConversationNode {
  id: string;
  kind: "main" | "answer" | "branch";
  label: string;
  answer?: NativeAnswer;
  index?: number;
  card?: TreeCard;
  children: ConversationNode[];
}

export function conversationOutline(snapshot: ChatSnapshot, presentation: Presentation, cards: TreeCard[], live: Record<string, TreeLive>, query = "", favoritesOnly = false): ConversationNode {
  const family = cards.filter((card) => card.rootKey === snapshot.conversationKey);
  function branch(card: TreeCard, ancestors = new Set<string>()): ConversationNode {
    const visited = new Set(ancestors).add(card.id);
    return { id: `branch:${card.id}`, kind: "branch", label: card.label, card, children: family.filter((item) => item.parentId === card.id && !visited.has(item.id)).map((item) => branch(item, visited)) };
  }
  const roots = family.filter((card) => !card.parentId);
  const children: ConversationNode[] = snapshot.answers.map((answer, index) => ({ id: `answer:${answer.id}`, kind: "answer", label: presentation.titles[answer.id] || answer.question || `回答 ${index + 1}`, answer, index, children: roots.filter((card) => card.sourceMessageId === answer.id).map((card) => branch(card)) }));
  // Keep saved references reachable when ChatGPT virtualizes an earlier answer.
  const loaded = new Set(snapshot.answers.map((answer) => answer.id));
  for (const card of roots.filter((item) => !loaded.has(item.sourceMessageId))) {
    const id = `answer:${card.sourceMessageId}`;
    let earlier = children.find((item) => item.id === id);
    if (!earlier) { earlier = { id, kind: "answer", label: "尚未加载的主线回答", children: [] }; children.push(earlier); }
    earlier.children.push(branch(card));
  }
  const search = query.trim().toLocaleLowerCase();
  function matching(node: ConversationNode): ConversationNode | null {
    const text = [node.label, node.answer?.question, node.answer?.text, node.card?.anchor?.text, node.card?.draft, ...(node.card ? live[node.card.id]?.turns.flatMap((turn) => [turn.question, turn.text]) ?? [] : [])].filter(Boolean).join(" ").toLocaleLowerCase();
    if (!search || text.includes(search)) return node;
    const children = node.children.map(matching).filter((item): item is ConversationNode => item !== null);
    return children.length ? { ...node, children } : null;
  }
  return { id: "main", kind: "main", label: "主线", children: children.filter((node) => !favoritesOnly || !!node.answer && presentation.favorites.includes(node.answer.id)).map(matching).filter((item): item is ConversationNode => item !== null) };
}
