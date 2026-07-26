import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type KeyboardEvent
} from "react";
import { ArrowUpRight, GitBranch, Send, Square, Trash2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SelectionAnchor } from "../lib/floating";
import {
  applySelectionHighlights,
  type HastNode
} from "../lib/selectionHighlight";
import type { Card, SelectionCardLink, Turn } from "../types";

export function LinkedMarkdown({
  content,
  links,
  onOpenLink
}: {
  content: string;
  links: SelectionCardLink[];
  onOpenLink: (linkId: string, anchor: SelectionAnchor) => void;
}) {
  const highlightPlugin = useMemo(
    () => () => (tree: HastNode) => applySelectionHighlights(tree, links),
    [links]
  );
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[highlightPlugin]}
      components={{
        mark: (props) => (
          <LinkedMark {...props} links={links} onOpenLink={onOpenLink} />
        )
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function LinkedMark({
  links,
  node,
  onOpenLink,
  ...props
}: ComponentPropsWithoutRef<"mark"> & {
  links: SelectionCardLink[];
  node?: unknown;
  onOpenLink: (linkId: string, anchor: SelectionAnchor) => void;
}) {
  void node;
  const linkId = String(
    (props as Record<string, unknown>)["data-selection-link-id"] ?? ""
  );
  const selectedText = links.find((link) => link.id === linkId)?.selectedText ?? "";

  function open(element: HTMLElement) {
    if (!linkId) return;
    const rect = element.getBoundingClientRect();
    onOpenLink(linkId, {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open(event.currentTarget);
  }

  return (
    <mark
      {...props}
      role="button"
      tabIndex={0}
      aria-label={`Open linked card for ${selectedText}`}
      onClick={(event) => open(event.currentTarget)}
      onKeyDown={handleKeyDown}
    />
  );
}

export function LinkedCardPreview({
  activeRequestCardId,
  anchor,
  card,
  deletionDisabled,
  modelConfigured,
  onCancel,
  onDelete,
  turns,
  onDismiss,
  onOpenCard,
  onSendMessage
}: {
  activeRequestCardId: string | null;
  anchor: SelectionAnchor;
  card: Card;
  deletionDisabled: boolean;
  modelConfigured: boolean;
  turns: Turn[];
  onCancel: () => void;
  onDelete: (cardId: string) => void;
  onDismiss: () => void;
  onOpenCard: (cardId: string) => void;
  onSendMessage: (cardId: string, content: string) => Promise<void> | void;
}) {
  const previewRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [draftState, setDraftState] = useState({
    cardId: card.id,
    content: ""
  });
  const draft = draftState.cardId === card.id ? draftState.content : "";
  const setDraft = (content: string) => {
    setDraftState({ cardId: card.id, content });
  };
  const position = positionPreview(anchor);
  const isGenerating = activeRequestCardId === card.id;
  const anotherCardIsGenerating =
    activeRequestCardId !== null && !isGenerating;
  const latestTurn = turns.at(-1);

  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [latestTurn?.assistantContent, latestTurn?.status, turns.length]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    function handlePointerDown(event: PointerEvent) {
      if (!previewRef.current?.contains(event.target as Node)) onDismiss();
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", onDismiss);
    const outsideListener = window.setTimeout(() => {
      window.addEventListener("pointerdown", handlePointerDown);
    }, 0);
    return () => {
      window.clearTimeout(outsideListener);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", onDismiss);
    };
  }, [onDismiss]);

  function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (
      !content
      || !modelConfigured
      || activeRequestCardId !== null
    ) {
      return;
    }
    setDraft("");
    void onSendMessage(card.id, content);
  }

  return (
    <aside
      ref={previewRef}
      className="linked-card-preview"
      aria-label={`Linked card ${card.title}`}
      style={position}
    >
      <header>
        <div>
          <span><GitBranch size={11} /> Linked card</span>
          <strong>{card.title}</strong>
        </div>
        <div className="linked-card-header-actions">
          <button
            aria-label={`Delete linked card ${card.title}`}
            disabled={deletionDisabled}
            onClick={() => onDelete(card.id)}
          >
            <Trash2 size={13} />
          </button>
          <button aria-label="Close linked card preview" onClick={onDismiss}>
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="linked-card-history" ref={historyRef}>
        {turns.length === 0 && (
          <p className="linked-card-empty">No messages in this card yet.</p>
        )}
        {turns.map((turn) => (
          <div className="linked-card-turn" key={turn.id}>
            <p className="linked-card-user">{turn.userContent}</p>
            <div className="linked-card-assistant">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {turn.assistantContent || "No answer yet."}
              </ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
      <footer>
        <form className="linked-card-composer" onSubmit={submitFollowUp}>
          <textarea
            aria-label={`Follow up in ${card.title}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter"
                && (event.metaKey || event.ctrlKey)
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask a follow-up…"
            rows={1}
            value={draft}
          />
          {isGenerating ? (
            <button
              aria-label="Stop linked card response"
              onClick={onCancel}
              type="button"
            >
              <Square size={12} />
            </button>
          ) : (
            <button
              aria-label="Send linked card follow-up"
              disabled={
                !draft.trim()
                || !modelConfigured
                || anotherCardIsGenerating
              }
              type="submit"
            >
              <Send size={12} />
            </button>
          )}
        </form>
        {!modelConfigured && (
          <small>Configure a model to follow up.</small>
        )}
        {anotherCardIsGenerating && (
          <small>Another card is generating.</small>
        )}
        <button
          className="linked-card-open"
          aria-label={`Open card ${card.title}`}
          onClick={() => onOpenCard(card.id)}
        >
          Open card <ArrowUpRight size={13} />
        </button>
      </footer>
    </aside>
  );
}

function positionPreview(anchor: SelectionAnchor): { left: number; top: number } {
  const width = 360;
  const estimatedHeight = 420;
  const margin = 12;
  const gap = 10;
  const rightSide = anchor.right + gap;
  const left = rightSide + width <= window.innerWidth - margin
    ? rightSide
    : Math.max(margin, anchor.left - width - gap);
  const top = Math.min(
    Math.max(margin, anchor.top - 28),
    Math.max(margin, window.innerHeight - estimatedHeight - margin)
  );
  return { left, top };
}
