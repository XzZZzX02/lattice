import { BrainCircuit, FolderPlus, Library, Plus, Settings2 } from "lucide-react";

const starterProjects = ["Attention mechanisms", "Local-first software"];

export function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <span className="brand-mark"><BrainCircuit size={20} /></span>
          <span>Lattice</span>
        </header>
        <nav className="quick-actions" aria-label="Workspace actions">
          <button><Plus size={17} /> New project</button>
          <button><FolderPlus size={17} /> New folder</button>
          <button><Library size={17} /> Import document</button>
        </nav>
        <section className="project-section">
          <p className="eyebrow">Local projects</p>
          {starterProjects.map((project, index) => (
            <button className={index === 0 ? "project active" : "project"} key={project}>
              <span className="project-dot" />
              {project}
            </button>
          ))}
        </section>
        <button className="settings"><Settings2 size={17} /> Settings</button>
      </aside>
      <section className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">Current exploration</p><h1>Attention mechanisms</h1></div>
          <span className="local-pill">Local only</span>
        </header>
        <div className="workspace-grid">
          <article className="conversation-card">
            <div className="card-kicker">ROOT CARD</div>
            <h2>How does attention reduce information bottlenecks?</h2>
            <div className="message user">Explain it from first principles.</div>
            <div className="message assistant">
              <p>Attention lets each token retrieve the most relevant context directly instead of compressing an entire sequence into one fixed representation.</p>
              <p>The mechanism creates a content-addressable path between a query and the surrounding keys and values.</p>
            </div>
          </article>
          <aside className="navigator" aria-label="Card tree">
            <p className="eyebrow">Card map</p>
            <div className="tree">
              <button className="tree-node muted">Parent</button>
              <span className="tree-line" />
              <button className="tree-node selected">Current</button>
              <div className="tree-children">
                <button className="tree-node child">Child</button>
                <button className="tree-node divergent">Divergent</button>
              </div>
            </div>
          </aside>
        </div>
        <form className="composer">
          <select aria-label="Model"><option>Ollama / qwen3</option></select>
          <textarea aria-label="Message" placeholder="Explore anything…  ⌘↵ to send" rows={1} />
          <button type="button" aria-label="Send">↑</button>
        </form>
      </section>
    </main>
  );
}
