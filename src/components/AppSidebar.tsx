import type { RefObject } from "react";
import {
  FileUp,
  Library,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload
} from "lucide-react";
import type {
  LocalDocument,
  Project,
  SearchResult
} from "../types";
import { LatticeLogo } from "./LatticeLogo";

interface AppSidebarProps {
  activeProjectId: string | null;
  documents: LocalDocument[];
  isCreating: boolean;
  loading: boolean;
  projects: Project[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  searchResults: SearchResult[];
  title: string;
  onCancelCreate: () => void;
  onCreateProject: (event: React.FormEvent) => void;
  onDeleteDocument: (document: LocalDocument) => void;
  onImportDocument: () => void;
  onImportProject: () => void;
  onOpenSettings: () => void;
  onSearch: (event: React.FormEvent) => void;
  onSearchQueryChange: (value: string) => void;
  onSelectCard: (cardId: string) => void;
  onSelectProject: (projectId: string) => void;
  onStartCreate: () => void;
  onTitleChange: (value: string) => void;
}

export function AppSidebar({
  activeProjectId,
  documents,
  isCreating,
  loading,
  projects,
  searchInputRef,
  searchQuery,
  searchResults,
  title,
  onCancelCreate,
  onCreateProject,
  onDeleteDocument,
  onImportDocument,
  onImportProject,
  onOpenSettings,
  onSearch,
  onSearchQueryChange,
  onSelectCard,
  onSelectProject,
  onStartCreate,
  onTitleChange
}: AppSidebarProps) {
  return (
    <aside className="sidebar">
      <header className="brand">
        <LatticeLogo />
        <span className="brand-wordmark">Lattice</span>
        <span className="version-tag">LOCAL</span>
      </header>

      <nav className="quick-actions" aria-label="Workspace actions">
        <button className="primary-nav-action" onClick={onStartCreate}>
          <Plus size={16} /> New project
        </button>
        <button disabled={!activeProjectId} onClick={onImportDocument}>
          <Library size={16} /> Import document
        </button>
        <button onClick={onImportProject}>
          <Upload size={16} /> Import project
        </button>
      </nav>

      <form className="search-form" onSubmit={onSearch}>
        <Search size={14} />
        <input
          ref={searchInputRef}
          aria-label="Search workspace"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search local content"
        />
        <kbd>⌘K</kbd>
      </form>

      {searchResults.length > 0 && (
        <div className="search-results" aria-label="Search results">
          {searchResults.map((result) => (
            <button
              key={`${result.entityType}-${result.entityId}`}
              onClick={() => result.cardId && onSelectCard(result.cardId)}
              title={result.excerpt}
            >
              <span className="search-result-type">{result.entityType}</span>
              <strong>{result.title}</strong>
              <span>{result.excerpt}</span>
            </button>
          ))}
        </div>
      )}

      {isCreating && (
        <form className="new-project-form" onSubmit={onCreateProject}>
          <label>
            <span>Project title</span>
            <input
              autoFocus
              aria-label="Project title"
              maxLength={200}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="Name this exploration"
              value={title}
            />
          </label>
          <div>
            <button type="button" onClick={onCancelCreate}>Cancel</button>
            <button type="submit" disabled={!title.trim()}>Create</button>
          </div>
        </form>
      )}

      <section className="project-section">
        <div className="sidebar-section-heading">
          <p className="section-label">Projects</p>
          <span>{projects.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="project-list">
          {projects.map((project) => (
            <button
              aria-label={`Open project ${project.title}`}
              className={activeProjectId === project.id ? "project active" : "project"}
              key={project.id}
              onClick={() => onSelectProject(project.id)}
              title={project.title}
            >
              <span className="project-glyph" aria-hidden="true" />
              <span>{project.title}</span>
            </button>
          ))}
        </div>
        {!loading && projects.length === 0 && (
          <p className="empty-copy">Create a project to begin exploring.</p>
        )}
      </section>

      {activeProjectId && (
        <section className="document-section">
          <div className="sidebar-section-heading">
            <p className="section-label">Sources</p>
            <span>{documents.length.toString().padStart(2, "0")}</span>
          </div>
          {documents.map((document) => (
            <div className="document-row" key={document.id}>
              <FileUp size={13} />
              <span title={document.name}>{document.name}</span>
              <button
                aria-label={`Delete document ${document.name}`}
                onClick={() => onDeleteDocument(document)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {documents.length === 0 && <p className="empty-copy">No local documents.</p>}
        </section>
      )}

      <button
        aria-label="Settings"
        className="settings"
        onClick={onOpenSettings}
      >
        <Settings2 size={16} />
        <span>Settings</span>
        <kbd>⌘,</kbd>
      </button>
    </aside>
  );
}
