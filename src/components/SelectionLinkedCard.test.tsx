import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Card, SelectionCardLink, Turn } from "../types";
import { LinkedCardPreview, LinkedMarkdown } from "./SelectionLinkedCard";

const card: Card = {
  id: "card-2",
  projectId: "project-1",
  parentId: "card-1",
  relation: "child",
  branchFromTurnId: null,
  title: "beta",
  summary: "Focus excerpt: beta",
  contextSnapshotHash: "",
  contextStale: false,
  unread: false,
  positionX: 0,
  positionY: 0,
  createdAt: "",
  updatedAt: ""
};

const link: SelectionCardLink = {
  id: "link-1",
  sourceTurnId: "turn-1",
  targetCardId: "card-2",
  selectedText: "beta",
  startOffset: 6,
  endOffset: 10,
  createdAt: ""
};

const turn: Turn = {
  id: "turn-2",
  cardId: "card-2",
  userContent: "Why beta?",
  assistantContent: "Because it is linked.",
  modelProfileId: "model-1",
  status: "completed",
  errorMessage: null,
  requestId: null,
  createdAt: "",
  updatedAt: ""
};

describe("LinkedMarkdown", () => {
  it("renders a persistent mark that opens its linked card preview", async () => {
    const user = userEvent.setup();
    const onOpenLink = vi.fn();
    render(
      <LinkedMarkdown
        content="Alpha **beta** gamma"
        links={[link]}
        onOpenLink={onOpenLink}
      />
    );

    const mark = screen.getByRole("button", { name: "Open linked card for beta" });
    await user.click(mark);
    expect(onOpenLink).toHaveBeenCalledWith(
      "link-1",
      expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) })
    );
  });

  it("opens a persistent mark with the keyboard only for activation keys", () => {
    const onOpenLink = vi.fn();
    render(
      <LinkedMarkdown
        content="Alpha beta gamma"
        links={[link]}
        onOpenLink={onOpenLink}
      />
    );
    const mark = screen.getByRole("button", { name: "Open linked card for beta" });

    fireEvent.keyDown(mark, { key: "ArrowDown" });
    expect(onOpenLink).not.toHaveBeenCalled();
    fireEvent.keyDown(mark, { key: "Enter" });
    expect(onOpenLink).toHaveBeenCalledOnce();
  });
});

describe("LinkedCardPreview", () => {
  it("shows the linked card's complete message history and opens the card", async () => {
    const user = userEvent.setup();
    const onOpenCard = vi.fn();
    render(
      <LinkedCardPreview
        anchor={{ left: 20, right: 60, top: 80, bottom: 100 }}
        card={card}
        onDismiss={vi.fn()}
        onOpenCard={onOpenCard}
        turns={[turn, { ...turn, id: "turn-3", assistantContent: "" }]}
      />
    );

    expect(screen.getAllByText("Why beta?")).toHaveLength(2);
    expect(screen.getByText("Because it is linked.")).toBeInTheDocument();
    expect(screen.getByText("No answer yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open card beta" }));
    expect(onOpenCard).toHaveBeenCalledWith("card-2");
  });

  it("shows an empty state before the new card has messages", () => {
    render(
      <LinkedCardPreview
        anchor={{ left: 20, right: 60, top: 80, bottom: 100 }}
        card={card}
        onDismiss={vi.fn()}
        onOpenCard={vi.fn()}
        turns={[]}
      />
    );

    expect(screen.getByText("No messages in this card yet.")).toBeInTheDocument();
  });

  it("dismisses with Escape, viewport changes, and an outside pointer", async () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <LinkedCardPreview
        anchor={{ left: 1000, right: 1010, top: 80, bottom: 100 }}
        card={card}
        onDismiss={onDismiss}
        onOpenCard={vi.fn()}
        turns={[]}
      />
    );
    const preview = screen.getByRole("complementary", { name: "Linked card beta" });
    expect(Number.parseFloat(preview.style.left)).toBeLessThan(1000);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent(window, new Event("resize"));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(3);
    unmount();
  });
});
