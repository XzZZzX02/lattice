import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrainCircuit, FileText, GitBranch, Network, Plus, Star, Workflow, X
} from "lucide-react";
import { useWorkspaceStore } from "./store/workspace";
import { ModelSettings } from "./components/ModelSettings";
import { CardNavigator } from "./components/CardNavigator";
import { MindscapePanel } from "./components/MindscapePanel";
import { AppSidebar } from "./components/AppSidebar";
import { CardActionsMenu } from "./components/CardActionsMenu";
import {
  ConfirmDialog,
  TextInputDialog
} from "./components/ActionDialog";
import { LatticeLogo } from "./components/LatticeLogo";
import { MessageComposer } from "./components/MessageComposer";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { SelectionToolbar } from "./components/SelectionActions";
import {
  LinkedCardPreview,
  LinkedMarkdown
} from "./components/SelectionLinkedCard";
import { summarizeCardSubtree } from "./lib/cardTree";
import type { SelectionAnchor } from "./lib/floating";
import { selectionFromContainer } from "./lib/selection";

export function App() {
  const {
    projects, workspace, loading, error, modelProfiles, activeModelProfileId,
    activeRequestId, activeRequestCardId, activeCardId, pendingQuotes, loadProjects, createProject,
    selectProject, loadModels, setActiveModel, sendMessage, cancelMessage,
    createCard, createCardFromSelection, deleteCard, selectCard, renameCard, addQuote, removeQuote, editTurn,
    deleteTurn, regenerateTurn, search, searchResults, favoriteTurnIds,
    toggleFavorite, exportProject, importProject, documents, importDocument,
    deleteDocument, documentCitations, mindscape, addMindNode, addMindEdge,
    updateMindNode, mindSuggestions, suggestingMindscape, suggestMindscape,
    applyMindSuggestions, dismissMindSuggestions
  } = useWorkspaceStore();
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState<{
    turnId: string;
    text: string;
    startOffset: number;
    endOffset: number;
    renderedStartOffset: number;
    renderedEndOffset: number;
    anchor: SelectionAnchor;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cardActionsRef = useRef<HTMLButtonElement>(null);
  const [activeCitation, setActiveCitation] = useState(
    null as (typeof documentCitations)[number] | null
  );
  const [navigatorMode, setNavigatorMode] = useState<"cards" | "mindscape">("cards");
  const [linkedPreview, setLinkedPreview] = useState<{
    linkId: string;
    anchor: SelectionAnchor;
  } | null>(null);
  const [pendingCardDeletion, setPendingCardDeletion] = useState<{
    projectId: string;
    cardId: string;
    title: string;
    cardIds: string[];
    cardCount: number;
    descendantCount: number;
    turnCount: number;
  } | null>(null);
  const [renameCardOpen, setRenameCardOpen] = useState(false);
  const [pendingDocumentDeletion, setPendingDocumentDeletion] = useState<
    (typeof documents)[number] | null
  >(null);
  const [pendingTurnDeletion, setPendingTurnDeletion] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [pendingTurnEdit, setPendingTurnEdit] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [pendingMindNode, setPendingMindNode] = useState<{
    sourceCardId: string;
    sourceTurnId: string | undefined;
    suggestedLabel: string;
    description: string;
  } | null>(null);
  const [pendingMindEdge, setPendingMindEdge] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);

  useEffect(() => {
    void loadProjects();
    void loadModels();
  }, [loadModels, loadProjects]);

  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.metaKey && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, []);

  async function submitProject(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await createProject(title);
    setTitle("");
    setIsCreating(false);
  }

  const activeCard = workspace?.cards.find((card) => card.id === activeCardId);
  const turns = workspace?.turns.filter((turn) => turn.cardId === activeCard?.id) ?? [];
  const activeSelectionLink = workspace?.selectionCardLinks.find(
    (link) => link.id === linkedPreview?.linkId
  );
  const linkedCard = workspace?.cards.find(
    (card) => card.id === activeSelectionLink?.targetCardId
  );
  const linkedTurns = workspace?.turns.filter(
    (turn) => turn.cardId === linkedCard?.id
  ) ?? [];
  const visibleCardDeletion =
    pendingCardDeletion?.projectId === workspace?.project.id
      ? pendingCardDeletion
      : null;

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!activeCard || !message.trim() || activeRequestCardId) return;
    const content = message;
    setMessage("");
    await sendMessage(activeCard.id, content, {
      quoteIds: pendingQuotes.map((quote) => quote.id)
    });
  }

  function addCard(
    relation: "child" | "divergent" | "branch",
    selectedText?: string
  ) {
    if (!workspace || !activeCard) return;
    const lastTurn = turns.at(-1);
    if (relation === "branch" && !lastTurn) return;
    void createCard({
      projectId: workspace.project.id,
      sourceCardId: activeCard.id,
      relation,
      title: relation === "child" ? "Deeper question" : relation === "divergent" ? "New direction" : "Alternative branch",
      branchFromTurnId: relation === "branch" ? lastTurn?.id : undefined,
      selectedText
    });
    setSelection(null);
  }

  function addSelectionCard() {
    if (!workspace || !activeCard || !selection) return;
    void createCardFromSelection({
      projectId: workspace.project.id,
      sourceCardId: activeCard.id,
      sourceTurnId: selection.turnId,
      title: selection.text.slice(0, 120),
      selectedText: selection.text,
      startOffset: selection.renderedStartOffset,
      endOffset: selection.renderedEndOffset
    });
    clearSelection();
  }

  function clearSelection() {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  const requestCardDeletion = useCallback((cardId: string) => {
    if (!workspace || activeRequestCardId) return;
    const card = workspace.cards.find((current) => current.id === cardId);
    const summary = summarizeCardSubtree(
      workspace.cards,
      workspace.turns,
      cardId
    );
    if (!card || card.relation === "root" || !summary) return;
    setPendingCardDeletion({
      projectId: workspace.project.id,
      cardId,
      title: card.title,
      ...summary
    });
  }, [activeRequestCardId, workspace]);

  async function deleteConfirmedCard() {
    const pending = pendingCardDeletion;
    if (
      !pending
      || activeRequestCardId
      || pending.projectId !== workspace?.project.id
    ) {
      return;
    }
    await deleteCard(pending.cardId);
    if (
      linkedCard
      && pending.cardIds.includes(linkedCard.id)
    ) {
      setLinkedPreview(null);
    }
    setPendingCardDeletion(null);
  }

  function addToMindscape(
    sourceCardId: string,
    sourceTurnId: string | undefined,
    suggestedLabel: string,
    description: string
  ) {
    if (!workspace) return;
    setPendingMindNode({
      sourceCardId,
      sourceTurnId,
      suggestedLabel: suggestedLabel.slice(0, 160),
      description
    });
  }

  return (
    <main className="app-shell">
      <AppSidebar
        activeProjectId={workspace?.project.id ?? null}
        documents={documents}
        isCreating={isCreating}
        loading={loading}
        projects={projects}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        searchResults={searchResults}
        title={title}
        onCancelCreate={() => setIsCreating(false)}
        onCreateProject={submitProject}
        onDeleteDocument={setPendingDocumentDeletion}
        onImportDocument={() => void importDocument()}
        onImportProject={() => void importProject()}
        onOpenSettings={() => setSettingsOpen(true)}
        onSearch={(event) => {
          event.preventDefault();
          void search(searchQuery);
        }}
        onSearchQueryChange={setSearchQuery}
        onSelectCard={selectCard}
        onSelectProject={(projectId) => void selectProject(projectId)}
        onStartCreate={() => setIsCreating(true)}
        onTitleChange={setTitle}
      />
      <section className="workspace">
        {error && <div className="error-banner" role="alert">{error}</div>}
        {workspace ? (
          <>
            <WorkspaceHeader
              title={workspace.project.title}
              onExport={(format) => void exportProject(format)}
            />
            <div className="workspace-grid">
              <article className="conversation-card">
                <div className="card-kicker">
                  <span />
                  {activeCard?.relation ?? "root"} card
                </div>
                <div className="card-title-row">
                  <h2 title={activeCard?.title}>{activeCard?.title}</h2>
                  <CardActionsMenu
                    canDelete={activeCard?.relation !== "root"}
                    deletionDisabled={activeRequestCardId !== null}
                    triggerRef={cardActionsRef}
                    onAddToMap={() => {
                      if (!activeCard) return;
                      addToMindscape(
                        activeCard.id,
                        undefined,
                        activeCard.title,
                        activeCard.summary
                      );
                    }}
                    onDelete={() => {
                      if (activeCard) requestCardDeletion(activeCard.id);
                    }}
                    onRename={() => setRenameCardOpen(true)}
                  />
                </div>
                {activeCard?.contextStale && <p className="stale-warning">Context changed upstream. Generate again to refresh this branch.</p>}
                {turns.length === 0 && <div className="empty-card">
                  <BrainCircuit size={28} />
                  <p>Ask the first question to start this card.</p>
                </div>}
                {turns.map((turn) => (
                  <div className="turn" key={turn.id}>
                    <div className="message user">{turn.userContent}</div>
                    <div className="turn-menu">
                      <button onClick={() => setPendingTurnEdit({
                        id: turn.id,
                        content: turn.userContent
                      })}>Edit</button>
                      <button onClick={() => void regenerateTurn(turn.id)}>Regenerate</button>
                      <button onClick={() => addToMindscape(
                        turn.cardId,
                        turn.id,
                        turn.userContent,
                        turn.assistantContent.slice(0, 800)
                      )}>Map</button>
                      <button
                        aria-label={favoriteTurnIds.includes(turn.id) ? "Remove favorite" : "Favorite"}
                        className={favoriteTurnIds.includes(turn.id) ? "favorited" : ""}
                        onClick={() => void toggleFavorite(turn.id, turn.cardId)}
                      ><Star size={11} fill="currentColor" /></button>
                      <button onClick={() => setPendingTurnDeletion({
                        id: turn.id,
                        title: turn.userContent.slice(0, 80)
                      })}>Delete</button>
                    </div>
                    <div
                      className={`message assistant ${turn.status}`}
                      onMouseUp={(event) => {
                        if (!turn.assistantContent) return;
                        const browserSelection = window.getSelection();
                        const selected = selectionFromContainer(
                          event.currentTarget,
                          turn.assistantContent,
                          browserSelection
                        );
                        if (!selected || !browserSelection?.rangeCount) return;
                        const range = browserSelection.getRangeAt(0);
                        const rect = range.getBoundingClientRect();
                        setSelection({
                          turnId: turn.id,
                          ...selected,
                          anchor: {
                            left: rect.left,
                            right: rect.right,
                            top: rect.top,
                            bottom: rect.bottom
                          }
                        });
                      }}
                    >
                      <LinkedMarkdown
                        content={turn.assistantContent || (turn.status === "streaming" ? "Thinking…" : "")}
                        links={workspace.selectionCardLinks.filter(
                          (link) => link.sourceTurnId === turn.id
                        )}
                        onOpenLink={(linkId, anchor) => {
                          setSelection(null);
                          setLinkedPreview({ linkId, anchor });
                        }}
                      />
                      {turn.errorMessage && <p className="turn-error">{turn.errorMessage}</p>}
                      {["failed", "cancelled", "interrupted"].includes(turn.status) && (
                        <button
                          className="retry-button"
                          onClick={() => activeCard && void sendMessage(
                            activeCard.id,
                            turn.userContent,
                            { quoteIds: [] }
                          )}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                    {documentCitations.some((citation) => citation.turnId === turn.id) && (
                      <div className="citation-list" aria-label="Document citations">
                        {documentCitations
                          .filter((citation) => citation.turnId === turn.id)
                          .map((citation, index) => (
                            <button
                              className={citation.available ? "" : "unavailable"}
                              key={citation.id}
                              onClick={() => setActiveCitation(citation)}
                            >
                              <FileText size={11} />
                              [{index + 1}] {citation.documentName}
                              {citation.pageNumber ? ` · p.${citation.pageNumber}` : ""}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
                {selection && (
                  <SelectionToolbar
                    anchor={selection.anchor}
                    canCreateCard={!workspace.selectionCardLinks.some((link) =>
                      link.sourceTurnId === selection.turnId
                      && link.startOffset === selection.renderedStartOffset
                      && link.endOffset === selection.renderedEndOffset
                    )}
                    onCopy={() => {
                      void navigator.clipboard.writeText(selection.text);
                      clearSelection();
                    }}
                    onCreateCard={addSelectionCard}
                    onDismiss={clearSelection}
                    onQuote={() => {
                      void addQuote({
                        turnId: selection.turnId,
                        selectedText: selection.text,
                        startOffset: selection.startOffset,
                        endOffset: selection.endOffset
                      });
                      clearSelection();
                    }}
                  />
                )}
                <footer className="card-actions">
                  <button onClick={() => addCard("child")}><Workflow size={15} /> Child</button>
                  <button onClick={() => addCard("divergent")}><Network size={15} /> Divergent</button>
                  <button disabled={turns.length === 0} onClick={() => addCard("branch")}><GitBranch size={15} /> Branch</button>
                </footer>
              </article>
              <div className="navigator-stack">
                <div className="navigator-tabs">
                  <button className={navigatorMode === "cards" ? "active" : ""} onClick={() => setNavigatorMode("cards")}>Cards</button>
                  <button className={navigatorMode === "mindscape" ? "active" : ""} onClick={() => setNavigatorMode("mindscape")}>Mindscape</button>
                </div>
                {navigatorMode === "cards" ? (
                  <CardNavigator
                    cards={workspace.cards}
                    activeCardId={activeCardId}
                    deletionDisabled={activeRequestCardId !== null}
                    onDelete={requestCardDeletion}
                    onSelect={selectCard}
                  />
                ) : (
                  <MindscapePanel
                    key={mindSuggestions
                      ? [...mindSuggestions.concepts, ...mindSuggestions.relations, ...mindSuggestions.merges]
                        .map((suggestion) => suggestion.id)
                        .join(":")
                      : "mindscape"}
                    graph={mindscape}
                    onOpenSource={(cardId) => {
                      selectCard(cardId);
                      setNavigatorMode("cards");
                    }}
                    onConnect={(sourceId, targetId) => {
                      setPendingMindEdge({ sourceId, targetId });
                    }}
                    onMove={(...args) => void updateMindNode(...args)}
                    suggestions={mindSuggestions}
                    suggesting={suggestingMindscape}
                    onSuggest={() => activeCard && void suggestMindscape(activeCard.id)}
                    onApplySuggestions={(acceptedIds) => void applyMindSuggestions(acceptedIds)}
                    onDismissSuggestions={dismissMindSuggestions}
                  />
                )}
              </div>
            </div>
            <div className="composer-row">
              <MessageComposer
                activeModelProfileId={activeModelProfileId}
                activeRequestId={activeRequestId}
                activeRequestCardId={activeRequestCardId}
                message={message}
                modelProfiles={modelProfiles}
                quotes={pendingQuotes}
                onCancel={() => void cancelMessage()}
                onMessageChange={setMessage}
                onModelChange={setActiveModel}
                onRemoveQuote={removeQuote}
                onSubmit={submitMessage}
              />
            </div>
          </>
        ) : (
          <section className="welcome">
            <LatticeLogo large />
            <p className="section-label">Local-first thinking</p>
            <h1>Turn a conversation into a map.</h1>
            <p>Create a project, follow an idea, and keep every branch available without losing context.</p>
            <button onClick={() => setIsCreating(true)}><Plus size={18} /> Create project</button>
          </section>
        )}
      </section>
      <ModelSettings open={settingsOpen} onOpenChange={(open) => {
        setSettingsOpen(open);
        if (!open) void loadModels();
      }} />
      <ConfirmDialog
        open={visibleCardDeletion !== null}
        title={`Delete ${visibleCardDeletion?.title ?? "card"}`}
        description={visibleCardDeletion ? (
          <>
            <p>
              This permanently removes {visibleCardDeletion.cardCount}{" "}
              card{visibleCardDeletion.cardCount === 1 ? "" : "s"},{" "}
              {visibleCardDeletion.descendantCount} descendant
              {visibleCardDeletion.descendantCount === 1 ? "" : "s"}, and{" "}
              {visibleCardDeletion.turnCount} message
              {visibleCardDeletion.turnCount === 1 ? "" : "s"}.
            </p>
            <p>This cannot be undone.</p>
          </>
        ) : null}
        confirmLabel="Delete permanently"
        cancelAriaLabel="Cancel card deletion"
        danger
        disabled={activeRequestCardId !== null}
        onConfirm={() => void deleteConfirmedCard()}
        onOpenChange={(open) => {
          if (!open) setPendingCardDeletion(null);
        }}
      />
      <TextInputDialog
        open={renameCardOpen && activeCard !== undefined}
        title="Rename card"
        label="Card title"
        initialValue={activeCard?.title ?? ""}
        submitLabel="Save title"
        returnFocus={() => cardActionsRef.current?.focus()}
        onSubmit={(nextTitle) => {
          if (activeCard) void renameCard(activeCard.id, nextTitle);
        }}
        onOpenChange={setRenameCardOpen}
      />
      <TextInputDialog
        open={pendingTurnEdit !== null}
        title="Edit message"
        label="Message"
        initialValue={pendingTurnEdit?.content ?? ""}
        submitLabel="Save message"
        onSubmit={(content) => {
          if (pendingTurnEdit) void editTurn(pendingTurnEdit.id, content);
          setPendingTurnEdit(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingTurnEdit(null);
        }}
      />
      <TextInputDialog
        open={pendingMindNode !== null}
        title="Add concept to Mindscape"
        label="Concept label"
        initialValue={pendingMindNode?.suggestedLabel ?? ""}
        submitLabel="Add concept"
        onSubmit={(label) => {
          if (!pendingMindNode || !workspace) return;
          void addMindNode({
            projectId: workspace.project.id,
            label,
            description: pendingMindNode.description,
            sourceCardId: pendingMindNode.sourceCardId,
            sourceTurnId: pendingMindNode.sourceTurnId
          });
          setNavigatorMode("mindscape");
          setPendingMindNode(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingMindNode(null);
        }}
      />
      <TextInputDialog
        open={pendingMindEdge !== null}
        title="Name relationship"
        label="Relationship"
        initialValue="relates to"
        submitLabel="Connect concepts"
        onSubmit={(relation) => {
          if (!pendingMindEdge || !workspace) return;
          void addMindEdge({
            projectId: workspace.project.id,
            sourceId: pendingMindEdge.sourceId,
            targetId: pendingMindEdge.targetId,
            relation
          });
          setPendingMindEdge(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingMindEdge(null);
        }}
      />
      <ConfirmDialog
        open={pendingDocumentDeletion !== null}
        title={`Delete ${pendingDocumentDeletion?.name ?? "document"}`}
        description={
          <p>
            Remove this source from the current project? Existing citation
            snapshots remain available.
          </p>
        }
        confirmLabel="Delete document"
        danger
        onConfirm={() => {
          if (pendingDocumentDeletion) {
            void deleteDocument(pendingDocumentDeletion.id);
          }
          setPendingDocumentDeletion(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDocumentDeletion(null);
        }}
      />
      <ConfirmDialog
        open={pendingTurnDeletion !== null}
        title="Delete dialogue"
        description={
          <p>
            Delete “{pendingTurnDeletion?.title}”? Its previous value remains
            in the local revision log.
          </p>
        }
        confirmLabel="Delete dialogue"
        danger
        onConfirm={() => {
          if (pendingTurnDeletion) void deleteTurn(pendingTurnDeletion.id);
          setPendingTurnDeletion(null);
        }}
        onOpenChange={(open) => {
          if (!open) setPendingTurnDeletion(null);
        }}
      />
      {linkedPreview && linkedCard && (
        <LinkedCardPreview
          activeRequestCardId={activeRequestCardId}
          anchor={linkedPreview.anchor}
          card={linkedCard}
          deletionDisabled={activeRequestCardId !== null}
          key={linkedCard.id}
          modelConfigured={activeModelProfileId !== null}
          onCancel={() => void cancelMessage()}
          onDelete={requestCardDeletion}
          turns={linkedTurns}
          onDismiss={() => setLinkedPreview(null)}
          onOpenCard={(cardId) => {
            selectCard(cardId);
            setLinkedPreview(null);
            setNavigatorMode("cards");
          }}
          onSendMessage={(cardId, content) =>
            sendMessage(cardId, content, { quoteIds: [] })
          }
        />
      )}
      {activeCitation && (
        <aside className="source-preview" aria-label="Document source">
          <header>
            <div>
              <strong>{activeCitation.documentName}</strong>
              <span>
                {activeCitation.pageNumber ? `Page ${activeCitation.pageNumber}` : "Text document"}
                {citationHeading(activeCitation.headingPath)}
              </span>
            </div>
            <button aria-label="Close source" onClick={() => setActiveCitation(null)}><X size={15} /></button>
          </header>
          {!activeCitation.available && <p className="source-unavailable">The source document was deleted. This is the citation snapshot saved with the answer.</p>}
          <blockquote>{activeCitation.excerpt}</blockquote>
          <small>Source range {activeCitation.startOffset}–{activeCitation.endOffset}</small>
        </aside>
      )}
    </main>
  );
}

function citationHeading(value: string): string {
  try {
    const path = JSON.parse(value) as unknown;
    return Array.isArray(path) && path.length > 0
      ? ` · ${path.filter((item): item is string => typeof item === "string").join(" › ")}`
      : "";
  } catch {
    return "";
  }
}
