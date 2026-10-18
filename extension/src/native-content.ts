// ChatGPT's native declarative/Intelligent UI owns its descendants and layout.
// Index its presence, not the live controls, counters, or animation frames.
export const NATIVE_INTERACTIVE = "[data-dil-source-message-id], [data-dil-message-id]";
export const INTERACTIVE_TEXT = "[原生交互内容]";
const OMIT = "script, style, template, button, input, select, textarea, svg, iframe, [hidden], [aria-hidden='true']";
const BLOCK = /^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|TR|SECTION|ARTICLE)$/;

export function hasNativeInteractive(element: HTMLElement): boolean {
  return element.matches(NATIVE_INTERACTIVE) || !!element.querySelector(NATIVE_INTERACTIVE);
}

// innerText forces style/layout in Chromium. This reader never measures the
// page, and prunes native applications before visiting their large subtrees.
export function indexText(element: HTMLElement): string {
  function read(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement) || node.matches(OMIT)) return "";
    if (node.matches(NATIVE_INTERACTIVE)) return ` ${INTERACTIVE_TEXT} `;
    if (node.tagName === "BR") return "\n";
    const text = [...node.childNodes].map(read).join("");
    return BLOCK.test(node.tagName) ? `\n${text}\n` : text;
  }
  return read(element).replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
