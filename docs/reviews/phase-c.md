# Phase C review

Compared range: `phase-b-chat...feat/phase-c-branching`

## Findings

- **High — context isolation requires path-based retrieval.** The original per-card history implementation could not express branch inheritance. Fixed with a relation-aware context builder and tests proving sibling content is excluded and branch history stops before the branch point.
- **Medium — React Fast Refresh boundary and graph bundle size.** Graph construction was exported beside a component and the production entry chunk exceeded 500 kB. Fixed by moving graph construction to a pure module and splitting graph/Markdown vendor chunks.
- **Medium — new card store paths lacked coverage.** Added create, select, and rename tests.
- No incorrect stale propagation or cross-project card creation was found.

## Verification

- Card creation validates source project and branch Turn ownership transactionally.
- A child edit marks only its descendants stale.
- Context snapshots are hashed and generation reserves 30% of the nominal context window.
- A synthetic 500-card graph builds within the 100 ms test budget.
