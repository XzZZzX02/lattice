# Phase D review — knowledge management

Baseline: `phase-c-branching`  
Reviewed commits: `c74d997..28614d2`

## Scope and checks

- Text selection, quote attachment, editing, regeneration and revision storage.
- FTS5 indexing, result navigation and favorites.
- Versioned JSON import/export and Markdown export.
- Project/card/turn ownership, transaction boundaries and stale-context propagation.
- `pnpm test:coverage`, `pnpm audit`, frontend production build.
- `cargo fmt --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings`.

## Findings

### P1 — Quote attachment did not enforce project ownership

An IPC caller could attach an unused quote from one project to a turn in another project, which
would leak its selected source into the target card context. Fixed by resolving the target project
inside the transaction and requiring every quote source to belong to that same project.

### P1 — Favorite inputs were independently valid but not relationally valid

`projectId`, `cardId` and `turnId` were protected by individual foreign keys, but a caller could
combine IDs from different projects. Fixed with a joined ownership check before toggling.

### P1 — Backup collision detection covered only the project ID

A crafted import with a new project ID and a colliding card, turn, quote or favorite ID would fail
instead of entering copy-import mode. Fixed by checking every imported identity namespace in
bounded batches before choosing whether to preserve or remap IDs.

### P2 — Quote offsets were trusted

The backend did not prove that the selected text matched the stored UTF-16 source range, and the
frontend always selected the first duplicate occurrence. Fixed with backend range validation and
occurrence-aware rendered-to-source mapping.

## Result

All P1/P2 findings were fixed. No P0 or deferred findings remain. The fixes are covered by
cross-project ownership, invalid range, duplicate-selection, backup validation and round-trip
tests.
