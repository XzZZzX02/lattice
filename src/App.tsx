import { useEffect, useState } from "react";
import { BrainCircuit, FolderPlus, Library, Plus, Settings2 } from "lucide-react";
import { useWorkspaceStore } from "./store/workspace";

export function App() {
  const { projects, workspace, loading, error, loadProjects, createProject, selectProject } =
    useWorkspaceStore();
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function submitProject(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    await createProject(title);
    setTitle("");
    setIsCreating(false);
  }

  const activeCard = workspace?.cards.find(
    (card) => card.id === workspace.project.rootCardId
  );

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
          <button><Library size={17} /> Import document</button>
        </nav>
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
        <button className="settings"><Settings2 size={17} /> Settings</button>
      </aside>
      <section className="workspace">
        {error && <div className="error-banner" role="alert">{error}</div>}
        {workspace ? (
          <>
            <header className="workspace-header">
              <div><p className="eyebrow">Current exploration</p><h1>{workspace.project.title}</h1></div>
              <span className="local-pill">Local only</span>
            </header>
            <div className="workspace-grid">
              <article className="conversation-card">
                <div className="card-kicker">{activeCard?.relation.toUpperCase()} CARD</div>
                <h2>{activeCard?.title}</h2>
                <div className="empty-card">
                  <BrainCircuit size={28} />
                  <p>Ask the first question to start this card.</p>
                </div>
              </article>
              <aside className="navigator" aria-label="Card tree">
                <p className="eyebrow">Card map</p>
                <div className="tree"><button className="tree-node selected">{activeCard?.title}</button></div>
              </aside>
            </div>
            <form className="composer">
              <select aria-label="Model"><option>Configure a model</option></select>
              <textarea aria-label="Message" placeholder="Explore anything…  ⌘↵ to send" rows={1} disabled />
              <button type="button" aria-label="Send" disabled>↑</button>
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
    </main>
  );
}
