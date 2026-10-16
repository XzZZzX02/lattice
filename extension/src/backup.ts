import { connectedBranches, conversationKey, readPresentation } from "./presentation";
import type { BranchLink, ChatSnapshot, Presentation } from "./types";
import type { TreeCard } from "./tree-types";
import { sanitizeTree } from "./tree-storage";

export interface PresentationBackup {
  format: "lattice-chatgpt";
  version: 1;
  conversationKey: string;
  sourceUrl: string;
  title: string;
  presentation: Presentation;
  branches: BranchLink[];
  tree?: TreeCard[];
}

export function createBackup(snapshot: ChatSnapshot, presentation: Presentation, branches: BranchLink[], tree?: TreeCard[]): PresentationBackup {
  if (!snapshot.conversationKey) throw new Error("请在已保存的 ChatGPT 会话中导出整理。");
  return { format: "lattice-chatgpt", version: 1, conversationKey: snapshot.conversationKey, sourceUrl: snapshot.url, title: snapshot.title, presentation, branches: connectedBranches(branches, snapshot.conversationKey), ...(tree ? { tree: sanitizeTree(tree, snapshot.conversationKey) } : {}) };
}

export function parseBackup(text: string, key: string | null): { presentation: Presentation; branches: BranchLink[]; tree?: TreeCard[] } {
  if (text.length > 4_000_000) throw new Error("整理文件过大，请选择小于 4 MB 的 JSON 文件。");
  let value: PresentationBackup;
  try { value = JSON.parse(text) as PresentationBackup; } catch { throw new Error("无法读取 JSON 整理文件。"); }
  if (!value || value.format !== "lattice-chatgpt" || value.version !== 1 || !value.presentation || value.presentation.version !== 1) throw new Error("这不是受支持的 Lattice 整理文件。");
  if (!key || value.conversationKey !== key || conversationKey(value.sourceUrl) !== key) throw new Error("请先打开此整理文件对应的 ChatGPT 原会话，再导入。");
  return { presentation: readPresentation(value.presentation), branches: connectedBranches(sanitizeBranches(value.branches), key), ...(value.tree ? { tree: sanitizeTree(value.tree, key) } : {}) };
}

export function sanitizeBranches(value: unknown): BranchLink[] {
  if (!Array.isArray(value)) return [];
  return value.filter((link): link is BranchLink => link && typeof link === "object" && typeof link.sourceKey === "string" && typeof link.targetKey === "string" && typeof link.sourceUrl === "string" && typeof link.targetUrl === "string" && conversationKey(link.sourceUrl) === link.sourceKey && conversationKey(link.targetUrl) === link.targetKey && link.sourceKey !== link.targetKey && typeof link.sourceMessageId === "string" && typeof link.sourceTitle === "string" && typeof link.targetTitle === "string" && typeof link.createdAt === "string").map((link) => {
    const excerpt = readPresentation({ version: 1, excerpts: link.excerpt ? [link.excerpt] : [] }).excerpts[0];
    const source = new URL(link.sourceUrl);
    const target = new URL(link.targetUrl);
    const hash = source.hash.startsWith("#lattice-message=") ? source.hash : "";
    return { sourceKey: link.sourceKey, sourceUrl: source.origin + source.pathname + hash, sourceMessageId: link.sourceMessageId, sourceTitle: link.sourceTitle.slice(0, 160), targetKey: link.targetKey, targetUrl: target.origin + target.pathname, targetTitle: link.targetTitle.slice(0, 160), createdAt: link.createdAt, ...(link.manual ? { manual: true } : {}), ...(excerpt ? { excerpt } : {}) };
  });
}

export function backupMarkdown(backup: PresentationBackup): string {
  const lines = [`# ${backup.title}`, "", `[ChatGPT 原会话](${backup.sourceUrl})`, "", "此文件包含 Lattice 整理和摘录。完整对话、附件和工具结果保存在 ChatGPT。", "", "## 摘录", ""];
  for (const excerpt of backup.presentation.excerpts) {
    lines.push(...excerpt.text.split("\n").map((line) => `> ${line}`), "", excerpt.note, "");
  }
  lines.push("## 思维图", "");
  for (const node of backup.presentation.mindNodes) lines.push(`- ${node.label}`);
  for (const edge of backup.presentation.mindEdges) {
    const source = backup.presentation.mindNodes.find((node) => node.id === edge.source)?.label;
    const target = backup.presentation.mindNodes.find((node) => node.id === edge.target)?.label;
    if (source && target) lines.push(`- ${source} → ${edge.label || "关联"} → ${target}`);
  }
  lines.push("", "## 会话分支", "");
  for (const branch of backup.branches) lines.push(`- [${branch.sourceTitle}](${branch.sourceUrl}) → [${branch.targetTitle}](${branch.targetUrl})`);
  if (backup.tree?.length) {
    lines.push("", "## 树形支线", "");
    for (const card of backup.tree) lines.push(`- ${card.parentId ? "子支线：" : "支线："}${card.label}${card.targetUrl ? ` · [原生上下文](${card.targetUrl})` : " · 尚未发送"}`, ...(card.anchor ? [`  > ${card.anchor.text.replace(/\n/g, " ")}`] : []));
  }
  return lines.join("\n");
}

export function downloadFile(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
