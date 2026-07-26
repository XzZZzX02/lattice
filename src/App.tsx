import { useEffect, useState } from "react";
import {
  BrainCircuit, Download, FileText, FolderPlus, GitBranch, Library, Network,
  Plus, Search, Settings2, Square, Star, Trash2, Upload, Workflow, X
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useWorkspaceStore } from "./store/workspace";
import { ModelSettings } from "./components/ModelSettings";
import { CardNavigator } from "./components/CardNavigator";
import { MindscapePanel } from "./components/MindscapePanel";
import { selectionFromContainer } from "./lib/selection";

export function App() {
  const {
    projects, workspace, loading, error, modelProfiles, activeModelProfileId,
    activeRequestId, activeCardId, pendingQuotes, loadProjects, createProject,
    selectProject, loadModels, setActiveModel, sendMessage, cancelMessage,
    createCard, selectCard, renameCard, addQuote, removeQuote, editTurn,
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
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCitation, setActiveCitation] = useState(
    null as (typeof documentCitations)[number] | null
  );
  const [navigatorMode, setNavigatorMode] = useState<"cards" | "mindscape">("cards");

  useEffect(() => {
    void loadProjects();
    void loadModels();
  }, [loadModels, loadProjects]);

  async function submitProject(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await createProject(title);
    setTitle("");
    setIsCreating(false);
  }

  const activeCard = workspace?.cards.find((card) => card.id === activeCardId);
  const turns = workspace?.turns.filter((turn) => turn.cardId === activeCard?.id) ?? [];

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!activeCard || !message.trim() || activeRequestId) return;
    const content = message;
    setMessage("");
    await sendMessage(activeCard.id, content);
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

  function addToMindscape(
    sourceCardId: string,
    sourceTurnId: string | undefined,
    suggestedLabel: string,
    description: string
  ) {
    if (!workspace) return;
    const label = window.prompt("Concept label", suggestedLabel.slice(0, 160));
    if (!label?.trim()) return;
    void addMindNode({
      projectId: workspace.project.id,
      label: label.trim(),
      description,
      sourceCardId,
      sourceTurnId
    });
    setNavigatorMode("mindscape");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <span className="brand-mark"><BrainCircuit size={20} /></span>
          <span>Lattice</span>
        </header>
        <nav className="quick-actions" aria-label="Workspace actions">
          <button onClick={() => setIsCreating(true)}><Plus size={17} /> New project</button>
          <button><FolderPlus size={17} /> New folder</button>
          <button disabled={!workspace} onClick={() => void importDocument()}><Library size={17} /> Import document</button>
          <button onClick={() => void importProject()}><Upload size={17} /> Import project</button>
        </nav>
        <form className="search-form" onSubmit={(event) => {
          event.preventDefault();
          void search(searchQuery);
        }}>
          <Search size={14} />
          <input aria-label="Search workspace" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search local content" />
        </form>
        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((result) => (
              <button key={`${result.entityType}-${result.entityId}`} onClick={() => result.cardId && selectCard(result.cardId)}>
                <strong>{result.title}</strong>
                <span>{result.excerpt}</span>
              </button>
            ))}
          </div>
        )}
        {isCreating && (
          <form className="new-project-form" onSubmit={submitProject}>
            <input
              autoFocus
              aria-label="Project title"
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Project title"
              value={title}
            />
            <div><button type="submit">Create</button><button type="button" onClick={() => setIsCreating(false)}>Cancel</button></div>
          </form>
        )}
        <section className="project-section">
          <p className="eyebrow">Local projects</p>
          {projects.map((project) => (
            <button
              aria-label={`Open project ${project.title}`}
              className={workspace?.project.id === project.id ? "project active" : "project"}
              key={project.id}
              onClick={() => void selectProject(project.id)}
            >
              <span className="project-dot" />
              {project.title}
            </button>
          ))}
          {!loading && projects.length === 0 && <p className="empty-copy">Create a project to begin exploring.</p>}
        </section>
        {workspace && (
          <section className="document-section">
            <p className="eyebrow">Documents</p>
            {documents.map((document) => (
              <div className="document-row" key={document.id}>
                <span title={document.name}>{document.name}</span>
                <button
                  aria-label={`Delete document ${document.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete “${document.name}” from this project?`)) {
                      void deleteDocument(document.id);
                    }
                  }}
                ><Trash2 size={12} /></button>
              </div>
            ))}
            {documents.length === 0 && <p className="empty-copy">No local documents.</p>}
          </section>
        )}
        <button className="settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /> Settings</button>
      </aside>
      <section className="workspace">
        {error && <div className="error-banner" role="alert">{error}</div>}
        {workspace ? (
          <>
            <header className="workspace-header">
              <div><p className="eyebrow">Current exploration</p><h1>{workspace.project.title}</h1></div>
              <div className="workspace-tools">
                <button onClick={() => void exportProject("json")} title="Export a restorable backup"><Download size={13} /> JSON</button>
                <button onClick={() => void exportProject("markdown")} title="Export a readable copy"><Download size={13} /> Markdown</button>
                <span className="local-pill">Local only</span>
              </div>
            </header>
            <div className="workspace-grid">
              <article className="conversation-card">
                <div className="card-kicker">{activeCard?.relation.toUpperCase()} CARD</div>
                <div className="card-title-row">
                  <h2>{activeCard?.title}</h2>
                  <div>
                    <button onClick={() => {
                      if (!activeCard) return;
                      addToMindscape(
                        activeCard.id,
                        undefined,
                        activeCard.title,
                        activeCard.summary
                      );
                    }}>Add to map</button>
                    <button onClick={() => {
                      if (!activeCard) return;
                      const title = window.prompt("Card title", activeCard.title);
                      if (title?.trim()) void renameCard(activeCard.id, title);
                    }}>Rename</button>
                  </div>
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
                      <button onClick={() => {
                        const content = window.prompt("Edit message", turn.userContent);
                        if (content?.trim()) void editTurn(turn.id, content);
                      }}>Edit</button>
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
                      <button onClick={() => {
                        if (window.confirm("Delete this dialogue? Its previous value remains in the local revision log.")) {
                          void deleteTurn(turn.id);
                        }
                      }}>Delete</button>
                    </div>
                    <div
                      className={`message assistant ${turn.status}`}
                      onMouseUp={(event) => {
                        const selected = selectionFromContainer(
                          event.currentTarget,
                          turn.assistantContent,
                          window.getSelection()
                        );
                        if (!selected) return;
                        setSelection({
                          turnId: turn.id,
                          ...selected
                        });
                      }}
                    >
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {turn.assistantContent || (turn.status === "streaming" ? "Thinking…" : "")}
                      </ReactMarkdown>
                      {turn.errorMessage && <p className="turn-error">{turn.errorMessage}</p>}
                      {["failed", "cancelled", "interrupted"].includes(turn.status) && (
                        <button
                          className="retry-button"
                          onClick={() => activeCard && void sendMessage(activeCard.id, turn.userContent)}
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
                  <div className="selection-toolbar" role="toolbar" aria-label="Selected text actions">
                    <span>“{selection.text.slice(0, 48)}{selection.text.length > 48 ? "…" : ""}”</span>
                    <button onClick={() => {
                      void addQuote({
                        turnId: selection.turnId,
                        selectedText: selection.text,
                        startOffset: selection.startOffset,
                        endOffset: selection.endOffset
                      });
                      setSelection(null);
                    }}>Quote</button>
                    <button onClick={() => addCard("child", selection.text)}>Child</button>
                    <button onClick={() => addCard("divergent", selection.text)}>Divergent</button>
                    <button onClick={() => void navigator.clipboard.writeText(selection.text)}>Copy</button>
                  </div>
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
                      const relation = window.prompt("Relationship", "relates to");
                      if (relation?.trim()) {
                        void addMindEdge({
                          projectId: workspace.project.id,
                          sourceId,
                          targetId,
                          relation: relation.trim()
                        });
                      }
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
            {pendingQuotes.length > 0 && (
              <div className="quote-tray">
                {pendingQuotes.map((quote) => (
                  <button key={quote.id} onClick={() => removeQuote(quote.id)} title="Remove quote">
                    “{quote.selectedText.slice(0, 44)}”
                  </button>
                ))}
              </div>
            )}
            <form className="composer" onSubmit={submitMessage}>
              <select aria-label="Model" value={activeModelProfileId ?? ""} onChange={(e) => setActiveModel(e.target.value)}>
                <option value="">Configure a model</option>
                {modelProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
              <textarea
                aria-label="Message"
                placeholder="Explore anything…  ⌘↵ to send"
                rows={1}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {activeRequestId ? (
                <button type="button" aria-label="Stop" onClick={() => void cancelMessage()}><Square size={13} /></button>
              ) : (
                <button type="submit" aria-label="Send" disabled={!message.trim() || !activeModelProfileId}>↑</button>
              )}
            </form>
          </>
        ) : (
          <section className="welcome">
            <span className="brand-mark large"><BrainCircuit size={30} /></span>
            <p className="eyebrow">Local-first thinking</p>
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
