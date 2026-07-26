# Phase G review — Selection-linked cards

Baseline: `phase-f-mindscape`

## Scope and checks

- Rendered UTF-16 selection coordinates across Markdown formatting boundaries.
- Atomic child-card and source-link creation with duplicate-range protection.
- Project-scoped asynchronous workspace updates and immediate child-card navigation.
- Removable composer quote chips and the three-action selection toolbar.
- Persistent linked-text marks, keyboard access and complete target-card history previews.
- Schema v4 backup validation, ID remapping and backward-compatible imports.
- `pnpm lint`, `pnpm typecheck`, tests, coverage, audit and production build.
- `cargo fmt --check`, `cargo test` and `cargo clippy --all-targets -- -D warnings`.

## Findings

### P1 — Selections crossing Markdown nodes were dropped

The initial implementation tried to translate visible text back into the raw Markdown source.
A selection such as `Alpha beta` across `Alpha **beta**` therefore could not be linked. Selection
links and quotes now consistently use rendered UTF-16 offsets. The highlighting transform splits
HAST text nodes at those coordinates, and regression tests cover formatting boundaries.

### P1 — Backup validation accepted semantically unrelated target cards

A syntactically valid selection link could target a card outside the source Turn's branch.
Schema v4 imports now require the target to be a Child whose parent is the source Turn's Card.
An invalid-backup regression test covers this boundary.

### P1 — A project switch could contaminate the newly active workspace

If card creation finished after the user switched projects, the response was appended to the new
workspace and selected there. Store updates and error reporting now verify the originating project
both before the request and when it settles. A deferred-response test covers the race.

### P1 — The repository accepted invalid source ranges

IPC validation alone did not protect direct repository callers from writing empty, overflowing or
out-of-bounds rendered ranges. The transaction now validates the source Turn and UTF-16 bounds
before inserting either record, so failures roll back without leaving an orphan card.

### P2 — The selection toolbar remained open after an outside click

The toolbar now installs a delayed outside-pointer listener so its own buttons remain usable while
a click elsewhere dismisses it. Component tests cover both paths.

## Result

All P0/P1/P2 findings are resolved. No deferred findings remain.
