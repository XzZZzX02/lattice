import { ArrowUp, ChevronDown, Square } from "lucide-react";
import type { ModelProfile, Quote } from "../types";
import { QuoteChips } from "./SelectionActions";

interface MessageComposerProps {
  activeModelProfileId: string | null;
  activeRequestId: string | null;
  activeRequestCardId: string | null;
  message: string;
  modelProfiles: ModelProfile[];
  quotes: Quote[];
  onCancel: () => void;
  onMessageChange: (value: string) => void;
  onModelChange: (profileId: string) => void;
  onRemoveQuote: (quoteId: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function MessageComposer({
  activeModelProfileId,
  activeRequestId,
  activeRequestCardId,
  message,
  modelProfiles,
  quotes,
  onCancel,
  onMessageChange,
  onModelChange,
  onRemoveQuote,
  onSubmit
}: MessageComposerProps) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-meta">
        <span className="composer-status"><span /> Ready</span>
        <label className="model-select">
          <span className="sr-only">Model</span>
          <select
            aria-label="Model"
            value={activeModelProfileId ?? ""}
            onChange={(event) => onModelChange(event.target.value)}
          >
            <option value="">Configure a model</option>
            {modelProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.name}</option>
            ))}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
      </div>
      <div className="composer-content">
        <QuoteChips quotes={quotes} onRemove={onRemoveQuote} />
        <textarea
          aria-label="Message"
          placeholder="Explore anything…"
          rows={1}
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <span className="composer-shortcut">⌘ ↵ to send</span>
      </div>
      {activeRequestId ? (
        <button
          className="composer-submit stop"
          type="button"
          aria-label="Stop"
          onClick={onCancel}
        >
          <Square size={13} />
        </button>
      ) : (
        <button
          className="composer-submit"
          type="submit"
          aria-label="Send"
          disabled={
            !message.trim()
            || !activeModelProfileId
            || activeRequestCardId !== null
          }
        >
          <ArrowUp size={16} />
        </button>
      )}
    </form>
  );
}
