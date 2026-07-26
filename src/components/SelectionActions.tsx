import { useEffect, useRef } from "react";
import { Copy, PanelsTopLeft, TextQuote, X } from "lucide-react";
import {
  positionFloatingToolbar,
  type SelectionAnchor
} from "../lib/floating";
import type { Quote } from "../types";

export function SelectionToolbar({
  anchor,
  canCreateCard,
  onCopy,
  onCreateCard,
  onDismiss,
  onQuote
}: {
  anchor: SelectionAnchor;
  canCreateCard: boolean;
  onCopy: () => void;
  onCreateCard: () => void;
  onDismiss: () => void;
  onQuote: () => void;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const position = positionFloatingToolbar(
    anchor,
    { width: window.innerWidth, height: window.innerHeight }
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    function handleViewportChange() {
      onDismiss();
    }
    function handlePointerDown(event: PointerEvent) {
      if (!toolbarRef.current?.contains(event.target as Node)) onDismiss();
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    const outsideListener = window.setTimeout(() => {
      window.addEventListener("pointerdown", handlePointerDown);
    }, 0);
    return () => {
      window.clearTimeout(outsideListener);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onDismiss]);

  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      role="toolbar"
      aria-label="Selected text actions"
      style={position}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button aria-label="Copy selected text" title="Copy" onClick={onCopy}>
        <Copy size={15} />
      </button>
      <button
        aria-label="Create card from selection"
        disabled={!canCreateCard}
        title={canCreateCard ? "Create card" : "This text already has a card"}
        onClick={onCreateCard}
      >
        <PanelsTopLeft size={15} />
      </button>
      <button
        aria-label="Quote selection in message"
        title="Add to conversation"
        onClick={onQuote}
      >
        <TextQuote size={15} />
      </button>
    </div>
  );
}

export function QuoteChips({
  quotes,
  onRemove
}: {
  quotes: Quote[];
  onRemove: (quoteId: string) => void;
}) {
  if (quotes.length === 0) return null;
  return (
    <div className="quote-chips" aria-label="Quoted context">
      {quotes.map((quote) => (
        <span className="quote-chip" key={quote.id}>
          <TextQuote aria-hidden="true" size={12} />
          <span>{quote.selectedText}</span>
          <button
            type="button"
            aria-label={`Remove quote ${quote.selectedText}`}
            onClick={() => onRemove(quote.id)}
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
