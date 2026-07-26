# Phase E review — documents and retrieval

Baseline: `phase-d-core-mvp`

## Scope and checks

- PDF, Markdown and TXT validation, managed-file copying, deduplication and deletion.
- Structured chunk ranges, Markdown heading paths, PDF page numbers and overlap behavior.
- FTS5 isolation by project, retrieval context budgeting and citation snapshots.
- Cascading document deletion, index cleanup and unavailable-source behavior.
- `pnpm test:coverage`, `pnpm audit`, frontend production build.
- `cargo fmt --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings`.

## Findings

### P1 — Interrupted document processing could remain active forever

Documents are inserted with `processing` status before chunk extraction. A process exit in that
window left the status active indefinitely. Fixed by converting interrupted processing rows to
`failed` when the database opens; re-importing the same content retries processing.

### P1 — Pre-provider failures could leave a chat turn streaming

Context building, retrieval, citation persistence or snapshot persistence can fail before the HTTP
request begins. Those paths previously returned without transitioning the turn. Fixed with a
single post-stream guard that persists and emits a failed turn for every unhandled streaming error.

### P2 — File-system transaction remnants were not reconciled

A crash during copy or staged deletion could leave `.importing` or `.deleting` files. Fixed with a
startup reconciliation pass: incomplete copies are removed, staged files with live database rows
are restored, and staged files whose rows were committed as deleted are removed.

### P2 — Project JSON backup does not yet carry managed document binaries

The Phase D schema intentionally covers the core workspace only. Adding binary documents requires
a schema-version change and an archive-size policy; doing that separately now would immediately be
superseded by the Phase F graph backup change. Deferred to Phase F, where one schema upgrade will
add documents, citations and Mindscape together. Until then, JSON export remains labeled as the
core project backup and Markdown remains a reading export.

## Result

All runtime P1/P2 findings were fixed. The single deferred backup-format item has a bounded target
in Phase F and does not affect document ingestion, retrieval, traceability or deletion safety.
