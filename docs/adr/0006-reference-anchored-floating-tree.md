# ADR 0006: References open floating conversation cards

Supersedes the in-flow card layout in ADR 0005. Native ChatGPT execution,
context inheritance, persistence and the independent desktop target remain.

## Interaction contract

A saved quotation has an underline in its original answer. Clicking it opens a
non-modal floating card beside that reference, without moving main-line messages.
Clicking or scrolling the main conversation, focusing its composer, Escape or the
explicit return control dismisses the surface. Scrolling inside the card does not.
Reopening the quote restores the same branch and any unfinished draft.

Only the currently inspected card occupies the floating surface. Selecting a
term in a branch answer creates a child, underlines that child reference in the
parent, and opens the child. Breadcrumb controls return to the parent. The full
hierarchy remains in the optional sidebar outline.

## Implementation

- Source quotes use Range objects and CSS Custom Highlights. Native message
  children, citation links and event handlers are not wrapped, moved or replaced.
  Only plain-text reference clicks are intercepted; existing native links and
  controls retain their own behavior. Ambiguous changed quotes are not rebound.
- A non-modal surface in the extension's existing Shadow DOM uses fixed viewport
  positioning. It chooses an available side or shortens its scrollable history
  below/above the quote on narrow screens. There is no blocking backdrop or focus
  trap. Native modal surfaces take precedence.
- The open card is transient UI state; loading saved tree metadata does not open
  it automatically. Closing changes presentation only and does not cancel a
  native generation, discard the branch URL or create a replacement conversation.
- Drafts debounce during editing and flush before the editor is detached. This
  covers pointerdown dismissal, which can remove the textarea before blur fires.
- Branch selections store real rendered offsets, including repeated terms. The
  same range resolution is used for main-line and child references.
- JSON tree metadata remains compatible with 0.2. Cards without a quote use the
  beginning of the source answer as their reference. Native worker coordination
  and permissions remain unchanged.

CSS highlights can decorate ranges without affecting layout; see the
[Custom Highlight API](https://www.w3.org/TR/css-highlight-api-1/) and
[highlight styling](https://www.w3.org/TR/css-pseudo/#highlight-styling).

## Verification

Integration tests cover reference reopening, outside/scroll dismissal, draft
flushing, child navigation, Escape, and original native node preservation. Range
tests cover repeated and changed quotations and native links. Placement tests
cover narrow screens, sidebar avoidance and resized viewports. Production bundle
checks execute the same reference click and main-composer dismissal without Node
globals. Browser verification is recorded in extension/ACCEPTANCE.md.
