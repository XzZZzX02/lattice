import { useRef, useState } from "react";
import { Download, FileJson, FileText, Upload, X } from "lucide-react";
import { backupMarkdown, createBackup, downloadFile, parseBackup } from "./backup";
import type { BranchLink, ChatSnapshot, Presentation, PresentationMutation } from "./types";

export function DataControls({ snapshot, presentation, links, mutate, report, ready }: { snapshot: ChatSnapshot; presentation: Presentation; links: BranchLink[]; mutate: (mutation: PresentationMutation) => Promise<boolean>; report: (message: string) => void; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [imported, setImported] = useState<ReturnType<typeof parseBackup> | null>(null);
  const input = useRef<HTMLInputElement>(null);
  function exportData(format: "json" | "md") {
    try {
      const backup = createBackup(snapshot, presentation, links);
      downloadFile(format === "json" ? JSON.stringify(backup, null, 2) : backupMarkdown(backup), `lattice-${snapshot.conversationKey?.slice(8)}.${format}`, format === "json" ? "application/json" : "text/markdown;charset=utf-8");
      setOpen(false);
    } catch (cause) { report(cause instanceof Error ? cause.message : "导出失败。"); }
  }
  return <div className="data-controls"><input ref={input} type="file" accept=".json,application/json" hidden aria-label="导入 Lattice 整理" onChange={(event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 4_000_000) { report("请选择小于 4 MB 的整理文件。"); return; }
    void file.text().then((text) => { setImported(parseBackup(text, snapshot.conversationKey)); setOpen(true); }).catch((cause: unknown) => report(cause instanceof Error ? cause.message : "导入失败。"));
  }} /><button title="导入与导出整理" aria-label="导入与导出整理" disabled={!ready || !snapshot.conversationKey} onClick={() => setOpen(!open)}><Download size={13} /></button>{open && <div className="data-menu"><div className="data-menu-heading"><strong>{imported ? "导入整理" : "整理数据"}</strong><button className="icon-button" aria-label="关闭数据菜单" onClick={() => { setOpen(false); setImported(null); }}><X size={14} /></button></div>{imported ? <><p>将替换本会话的本地整理：{imported.presentation.excerpts.length} 条摘录，{imported.presentation.mindNodes.length} 个概念。ChatGPT 原会话保留。</p><button className="data-action" onClick={() => { void mutate({ type: "restore", ...imported }); setImported(null); setOpen(false); }}>导入并替换本地整理</button></> : <><p>备份卡片标题、置顶、摘录、笔记、思维图和分支关系。</p><button className="data-action" onClick={() => exportData("json")}><FileJson size={15} />导出 JSON 备份</button><button className="data-action" onClick={() => exportData("md")}><FileText size={15} />导出 Markdown 摘录</button><button className="data-action" onClick={() => input.current?.click()}><Upload size={15} />导入 JSON 备份</button></>}</div>}</div>;
}
