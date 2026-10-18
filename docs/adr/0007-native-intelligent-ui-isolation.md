# Native Intelligent UI isolation

Date: 2026-10-18
Status: Accepted

## Evidence

The affected native ChatGPT answer contains `data-dil-source-message-id` and
`data-dil-message-id` containers. The inspected GPU layout lab had 1,266 elements
and 143 controls. It is an application rendered directly in the conversation,
not a separate iframe or a static Markdown answer.

Previously, every observed body mutation scheduled a full conversation scan.
That scan read `innerText`, which can force Chromium style/layout work. Even
unchanged snapshots were published; the React decoration effect then removed
and reapplied answer geometry attributes. Native widget updates could therefore
keep restarting indexing, rendering, decoration and layout work. The native
relay also searched application buttons and editors as candidate chat controls.

## Decision

- Treat the observed DIL containers as native application boundaries. Preserve
  their DOM, handlers, controls and geometry. Keep their answer in the tree.
- Index prose using a DOM text reader, without layout reads, and prune the
  application subtree. Show a stable interactive-content marker in the index.
- Ignore internal application mutations for conversation indexing, while still
  detecting native dialogs, message replacement, streaming prose, page switches,
  message identity changes and title updates. Deduplicate unchanged snapshots.
- Patch answer decoration idempotently. Do not decorate answers that contain
  native applications. Dispose removed decorations and unmounted workspaces.
- Exclude application buttons and editors from native chat control discovery.
  Markdown projection retains surrounding prose and points users to the native
  branch for interactive content; it does not flatten the live application.

No permissions, private endpoints, model calls, native application code, or
conversation context rules change.

## Validation and limits

Regression tests cover native application pruning, zero additional text reads
or navigation publications during 20 simulated widget frames over five seconds,
idempotent decorations, original handlers, native composer isolation, streaming,
dialogs, title/identity changes, and active-page navigation. Production-bundle
verification also executes a DIL fixture and checks that animation causes no
answer-decoration mutations.

Chrome validation used the user's existing AI Infra Lab conversation with the
installed extension enabled. Switching Source Layout from Row-major to
Column-major updated the tile mapping; returning to Row-major restored it.
Lattice search and clearing search remained responsive alongside the native UI.
No model question was sent. This is an interaction regression check, not a
long-running CPU/memory benchmark or a claim about every future native UI shape.
