# ADR 0005: Inline conversations are the primary interaction

Supersedes the sidebar-first interaction in ADR 0004. Native ChatGPT execution,
original DOM preservation, and the independent desktop target remain in place.

## User problem and acceptance contract

A reader encounters an unfamiliar term in the first answer of a long chat.
Explaining it should not append a detour to the main conversation or move the
reader to another page. Select the term, open an inline card, ask multiple
questions, collapse it, continue the main line, reopen and continue the same
branch. A branch answer can itself own nested branches. Excerpts, notes and
mind maps remain supplementary organization tools.

## Implementation

- Tree cards persist their root conversation, parent card, exact source message,
  quote, draft, collapsed state and bound native conversation URL. The sidebar
  shows a navigable outline beneath each main-line answer.
- Each root card mounts in its own Shadow DOM immediately after its original
  answer. Original answer children, citations and handlers are retained.
- Creating a card is local. Only an explicit card send creates an inactive copy
  of the source ChatGPT page and invokes the selected answer's native branch
  action. The main tab is never navigated or submitted by this operation.
- The native menu adapter follows the conversation-branch submenu and selects
  the new-chat option, preserving the ChatGPT account's native context rules.
- A branch is bound only after an extension-created worker page, armed for that
  exact source message, reaches a new saved conversation. Further sends target
  that conversation; a child card forks from its parent branch answer.
- Background coordination is serialized. Commands are claimed at most once.
  A native timeout, page reload or ambiguous composer is reported; prompts are
  never silently replayed. Existing native drafts are never overwritten.
- Native worker pages report rendered messages through extension messaging.
  Cards show a read-only Markdown projection with links and code. Native tool
  execution, attachments, approvals and rich surfaces remain accessible through
  the explicit open-native-branch control.
- No model API, private ChatGPT endpoint, cookies or credentials are used. The
  manifest still requests storage only. Native worker tabs are ordinary visible
  tabs, not hidden account sessions. Chrome supports tab creation and messaging
  without a broad tabs permission.

## Persistence and boundaries

Tree metadata and user drafts use Chrome local storage. Branch answer projections
and worker state use Chrome session storage, which can disappear after browser
or extension restart. Native conversation URLs restore the real cloud context;
opening a card can reload its branch without generating a response. Backups
include tree metadata and context URLs, not the complete branch transcripts.
Collapsing a card does not clear its context. Clearing local organization does
not delete ChatGPT conversations. Native DOM changes, background tab throttling,
login requirements and approval dialogs can require opening the native page.

## Verification

Regression tests cover isolated contexts, repeated sends, nested parentage,
collapse persistence, at-most-once commands, restart behavior, untouched native
composers, unsafe content projection and new-chat submenus. The built bundles
are executed without Node globals before packaging. Authenticated browser
acceptance is recorded separately from local simulated demonstration data.
