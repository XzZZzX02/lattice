# Native UI in floating branch cards

Date: 2026-10-19
Status: Accepted

The 0.3.x relay converted answers to Markdown and replaced DIL applications with
an instruction to open their native tab. That interrupted the reference-anchored
reading workflow. This decision extends ADR 0007; its indexing isolation remains.

Answers now contain ordered Markdown and native-surface descriptors. Native DOM
and SVG are sampled on demand in the original managed branch, together with its
stylesheets, inline/CSSOM styles, inherited variables and control state. Owned
portal menus can be included through aria-controls/aria-owns. The original
application DOM, React handlers and model conversation remain in that branch.

A script-disabled, same-origin sandbox frame in the card renders a sanitized
visual projection. Stable node identifiers support incremental DOM updates,
retaining text carets, focus and scrolling. No application script is executed a
second time. User clicks, native input/select changes and navigation keys are
sent to the corresponding original control through the existing extension's
content-script channel. Actions have non-replayed IDs and are checked against
the branch key, answer identity, surface session and still-connected nodes.

Only visible card surfaces poll. Unchanged revisions send no HTML; animation
snapshots are limited to two per second. Source observers only mark the requested
surface dirty, expire after inactivity and never restart conversation indexing.
HTML/CSS are returned directly, never saved in extension local/session storage or
backups. There are bounded node, byte, queue, surface-cache and action-history
limits. Opening an existing card also recovers a closed managed tab, without
resending a prior prompt.
Surface reads bypass the persistence queue and have a response deadline, so a
sleeping tab cannot block main-line organization. Expired input actions are
rejected rather than executed later when a source tab wakes up. Closing a card
also releases its frame listeners and resize observer.

The renderer removes scripts, handlers, embedded frames and submission targets;
forms retain their layout/controls as inert containers. Browser permissions
remain storage only. Communication uses [tabs.sendMessage](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage)
to a managed top-level content script; no debugger, capture or header-rewriting
permission is introduced and no native CSP headers are changed.

This is a DOM projection, not an arbitrary native browser instance. Canvas is
sampled when readable; protected canvases, nested applications, browser dialogs,
file selection and APIs requiring a trusted gesture in the source tab are not
guaranteed. The original-tab button remains available for those cases. Native
application state survives hiding/reopening a card while its source remains
loaded; closing/reloading that source retains ChatGPT context but can reset
application-local UI state, just as a native page reload can.
