# ADR 0004: ChatGPT-native execution with a browser presentation extension

## Decision

Add a separate Manifest V3 Chrome/Edge build. ChatGPT remains the authority for
conversations, context, model selection, citations, attachments, and agent/tool
execution. Lattice supplies local presentation and knowledge organization. The
desktop React/Tauri/Rust application remains a separate supported target.

## Boundaries

- An isolated-world content script observes rendered messages through a small
  DOM adapter. Original message nodes, event handlers, and native controls stay
  in their original tree. A React workspace mounts in its own Shadow DOM.
- Native card styles use reversible data attributes. Excerpt links use the CSS
  Custom Highlight API rather than wrapping text that React owns.
- Native branch creation is an explicit user action on a selected answer. The
  adapter opens that answer's recognized native menu and returns the exact
  branch control; it does not request generation or invoke undocumented APIs.
- The background worker arms a short-lived branch correlation only immediately
  before that native action. A new saved ChatGPT conversation in the source tab
  or a recorded child tab can be linked once. Unrelated tabs without an armed
  action are not recorded. An explicit manual link is available when native
  navigation omits opener information or menu recognition fails.
- A graph edge is presentation metadata, never an instruction to alter model
  context. The desktop application's bespoke context construction rules do not
  migrate into the extension.
- Chrome local storage contains user organization, selected excerpts, notes,
  concept graphs, and branch provenance. Complete rendered responses are used
  transiently for navigation/search and are not automatically persisted.
  Storage writes from multiple tabs are serialized in the service worker.
- Imports validate format, origin, and original conversation identity. Backups
  restore local presentation, not ChatGPT conversations or cloud artifacts.

## Reuse

Reuse the existing brand, React, Lucide, React Flow, rendered-selection anchoring,
and floating-surface placement. Do not import Tauri IPC into the content script.
Use native ChatGPT projects, files, citations, history, composer, editing,
regeneration, and tool controls instead of building second implementations.

## Compatibility and verification

The DOM contract is intentionally narrow and replaceable. When stable message
identity is missing, navigation remains available and persistent actions are
disabled. When native branch discovery fails, guide the user to the original
menu and allow explicit association; never silently fall back to another model
backend. Source text that has changed or become ambiguous is not silently
reattached to another occurrence.

Automated tests cover DOM identity/event preservation, streamed text, excerpt
offsets, stale menus, multi-tab write ordering, same-tab and child-tab branches,
expired branch intent, stale-route edits, and backup validation. Browser smoke
tests use an explicitly labeled local fixture. Live authenticated ChatGPT
compatibility remains a separate acceptance check and is not implied by fixture
success.
