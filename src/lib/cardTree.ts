import type { Card, Turn } from "../types";

export interface CardSubtreeSummary {
  cardIds: string[];
  cardCount: number;
  descendantCount: number;
  turnCount: number;
}

export function summarizeCardSubtree(
  cards: Card[],
  turns: Turn[],
  rootCardId: string
): CardSubtreeSummary | null {
  if (!cards.some((card) => card.id === rootCardId)) return null;
  const children = new Map<string, string[]>();
  for (const card of cards) {
    if (!card.parentId) continue;
    const siblings = children.get(card.parentId) ?? [];
    siblings.push(card.id);
    children.set(card.parentId, siblings);
  }
  const cardIds: string[] = [];
  const queue = [rootCardId];
  for (let index = 0; index < queue.length; index += 1) {
    const cardId = queue[index];
    cardIds.push(cardId);
    queue.push(...(children.get(cardId) ?? []));
  }
  const included = new Set(cardIds);
  return {
    cardIds,
    cardCount: cardIds.length,
    descendantCount: cardIds.length - 1,
    turnCount: turns.filter((turn) => included.has(turn.cardId)).length
  };
}
