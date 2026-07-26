import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { positionFloatingToolbar } from "../lib/floating";
import { QuoteChips, SelectionToolbar } from "./SelectionActions";

describe("positionFloatingToolbar", () => {
  it("centers above the selected text and stays inside the viewport", () => {
    expect(positionFloatingToolbar(
      { left: 180, right: 220, top: 100, bottom: 120 },
      { width: 400, height: 300 },
      { width: 156, height: 42 }
    )).toEqual({ left: 122, top: 50 });

    expect(positionFloatingToolbar(
      { left: 2, right: 18, top: 2, bottom: 20 },
      { width: 200, height: 100 },
      { width: 156, height: 42 }
    )).toEqual({ left: 8, top: 28 });
  });
});

describe("SelectionToolbar", () => {
  it("shows exactly copy, create card, and quote actions", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onCreateCard = vi.fn();
    const onQuote = vi.fn();
    render(
      <SelectionToolbar
        anchor={{ left: 180, right: 220, top: 100, bottom: 120 }}
        canCreateCard
        onCopy={onCopy}
        onCreateCard={onCreateCard}
        onDismiss={vi.fn()}
        onQuote={onQuote}
      />
    );

    const toolbar = screen.getByRole("toolbar", { name: "Selected text actions" });
    expect(toolbar.querySelectorAll("button")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Copy selected text" }));
    await user.click(screen.getByRole("button", { name: "Create card from selection" }));
    await user.click(screen.getByRole("button", { name: "Quote selection in message" }));
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCreateCard).toHaveBeenCalledOnce();
    expect(onQuote).toHaveBeenCalledOnce();
  });

  it("disables duplicate card creation and closes with Escape", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <SelectionToolbar
        anchor={{ left: 20, right: 40, top: 20, bottom: 40 }}
        canCreateCard={false}
        onCopy={vi.fn()}
        onCreateCard={vi.fn()}
        onDismiss={onDismiss}
        onQuote={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Create card from selection" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("closes when the next pointer interaction is outside the toolbar", async () => {
    const onDismiss = vi.fn();
    render(
      <SelectionToolbar
        anchor={{ left: 20, right: 40, top: 20, bottom: 40 }}
        canCreateCard
        onCopy={vi.fn()}
        onCreateCard={vi.fn()}
        onDismiss={onDismiss}
        onQuote={vi.fn()}
      />
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fireEvent.pointerDown(document.body);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("QuoteChips", () => {
  it("renders removable quote tags inside the composer", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <QuoteChips
        onRemove={onRemove}
        quotes={[{
          id: "quote-1",
          turnId: "turn-1",
          targetTurnId: null,
          selectedText: "quoted context",
          startOffset: 0,
          endOffset: 14,
          createdAt: ""
        }]}
      />
    );

    expect(screen.getByText("quoted context")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove quote quoted context" }));
    expect(onRemove).toHaveBeenCalledWith("quote-1");
  });
});
