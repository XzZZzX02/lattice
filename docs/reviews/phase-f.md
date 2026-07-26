# Phase F review — Mindscape

Baseline: `phase-e-documents`

## Scope and checks

- Project-scoped Mindscape nodes, edges and many-to-one source traceability.
- Card/Turn source navigation, node movement and user-created relations.
- AI suggestion parsing, normalization, review UI, rejection and confirmation.
- Merge source preservation, relation rewiring and transaction boundaries.
- Schema v1/v2/v3 backup compatibility, ID remapping and managed-file restoration.
- `pnpm test:coverage`, `pnpm audit`, frontend production build.
- `cargo fmt --check`, `cargo test`, `cargo clippy --all-targets -- -D warnings`.

## Findings

### P1 — Applying a selected suggestion batch was not atomic

Concepts, relations and merges were initially applied through separate repository transactions.
A later failure could leave only part of the user-approved set. Fixed by validating the accepted
IDs and executing the complete batch in one SQLite transaction. A rollback regression test covers
an invalid item after a valid item.

### P1 — Source `SET NULL` rules could conflict with the source-presence check

Deleting a Card tree could null both source columns and violate the table check, blocking the
cascade. Migration 0006 changes source references to cascade-delete their link rows while keeping
the concept and its other sources intact. Project deletion is covered by a database test.

### P1 — Final backups would have omitted managed documents and citation state

Phase E deliberately deferred the binary format decision. Fixed with self-contained schema v3:
document bytes, chunks and citation snapshots are included; SHA-256 is verified before restore;
managed paths are regenerated rather than trusted; and a failed database import removes restored
files. Schema v1 and v2 remain accepted.

## Result

All P0/P1/P2 findings are resolved. No deferred findings remain.
