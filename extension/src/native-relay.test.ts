import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeComposer, projectMarkdown, sendNativePrompt } from "./native-relay";
afterEach(() => { document.body.innerHTML = ""; vi.unstubAllGlobals(); });
describe("native conversation bridge", () => {
  it("projects citations and code without executing HTML or copying controls", () => {
    const element = document.createElement("div");
    element.innerHTML = '<p>A <strong>term</strong> <a href="https://example.org/paper">source</a>.</p><pre><code>x &lt; y</code></pre><button>Copy</button><script>alert(1)</script><a href="javascript:alert(1)">unsafe</a>';
    const result = projectMarkdown(element);
    expect(result).toContain("**term**");
    expect(result).toContain("[source](https://example.org/paper)");
    expect(result).toContain("x < y");
    expect(result).not.toMatch(/javascript:|<script|Copy/);
  });
  it("finds only the active native composer and refuses to replace a draft", async () => {
    document.body.innerHTML = '<div data-app-shell-active-page="false"><main><textarea>Old page</textarea></main></div><div data-app-shell-active-page="true"><main><textarea id="prompt-textarea">Existing draft</textarea><button aria-label="Send">Send</button></main></div>';
    expect(nativeComposer()?.id).toBe("prompt-textarea");
    const key = "chatgpt:source";
    vi.stubGlobal("location", { href: "https://chatgpt.com/c/source" });
    await expect(sendNativePrompt(key, "New question")).rejects.toThrow("已有草稿");
    expect((nativeComposer() as HTMLTextAreaElement).value).toBe("Existing draft");
  });
  it("sends once through the original composer and refuses a stale context", async () => {
    document.body.innerHTML = '<main><textarea id="prompt-textarea"></textarea><button aria-label="Send">Send</button></main>';
    vi.stubGlobal("location", { href: "https://chatgpt.com/c/branch" });
    const clicked = vi.fn();
    document.querySelector("button")!.addEventListener("click", clicked);
    await expect(sendNativePrompt("chatgpt:main", "Wrong context")).rejects.toThrow("已经切换");
    await sendNativePrompt("chatgpt:branch", "Continue this branch");
    expect(clicked).toHaveBeenCalledOnce();
    expect((nativeComposer() as HTMLTextAreaElement).value).toBe("Continue this branch");
  });
});
