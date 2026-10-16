import { useState } from "react";
import { Link2 } from "lucide-react";
import { request } from "./platform";
import type { ChatSnapshot } from "./types";

export function LinkBranch({ snapshot }: { snapshot: ChatSnapshot }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const sources = snapshot.answers.filter((answer) => answer.stableId);
  return <div className="link-branch"><button className="text-button" disabled={!snapshot.conversationKey || !sources.length} onClick={() => setOpen(!open)}><Link2 size={13} />关联已有原生分支</button>{open && <form onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const answer = sources.find((item) => item.id === values.get("source"));
    if (!answer || !snapshot.conversationKey) return;
    setSaving(true);
    void request({ type: "branch:link", sourceKey: snapshot.conversationKey, sourceUrl: snapshot.url, sourceMessageId: answer.id, sourceTitle: answer.question || snapshot.title, targetUrl: String(values.get("url")), targetTitle: String(values.get("title")) }).then(() => { setStatus("已关联原生会话。"); setOpen(false); }, (cause: unknown) => setStatus(cause instanceof Error ? cause.message : "关联失败。")).finally(() => setSaving(false));
  }}><p>已从 ChatGPT 原生菜单创建分支？粘贴新会话地址，在这里补充关系。</p><label>分支起点<select name="source">{sources.map((answer, index) => <option key={answer.id} value={answer.id}>{answer.question || `回答 ${index + 1}`}</option>)}</select></label><label>新会话地址<input type="url" name="url" required placeholder="https://chatgpt.com/c/…" /></label><label>分支名称<input name="title" maxLength={160} placeholder="给这个方向起个名字" /></label><button className="branch-button" disabled={saving} type="submit">记录已有分支关系</button></form>}{status && <p className="tip" role="status">{status}</p>}</div>;
}
