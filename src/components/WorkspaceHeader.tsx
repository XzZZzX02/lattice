import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Download, Ellipsis, FileJson, FileText } from "lucide-react";

export function WorkspaceHeader({
  title,
  onExport
}: {
  title: string;
  onExport: (format: "json" | "markdown") => void;
}) {
  return (
    <header className="workspace-header">
      <div className="workspace-heading">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <p className="section-label">Current exploration</p>
          <h1 title={title}>{title}</h1>
        </div>
      </div>
      <div className="workspace-tools">
        <span className="local-pill"><span /> Local only</span>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="icon-button"
              aria-label="Project actions"
              type="button"
            >
              <Ellipsis size={17} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="dropdown-content"
              align="end"
              sideOffset={8}
            >
              <DropdownMenu.Label className="dropdown-label">
                Export project
              </DropdownMenu.Label>
              <DropdownMenu.Item
                className="dropdown-item"
                onSelect={() => onExport("json")}
              >
                <FileJson size={14} /> Export JSON
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="dropdown-item"
                onSelect={() => onExport("markdown")}
              >
                <FileText size={14} /> Export Markdown
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="dropdown-separator" />
              <div className="dropdown-hint">
                <Download size={12} /> Stored on this Mac
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
