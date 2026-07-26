# Phase H review

Date: 2026-07-27
Base: `phase-g-selection-links`
Branch: `feat/phase-h-card-workflow-debug`

## Scope

Reviewed the complete Phase H diff for floating-card follow-up behavior,
request ownership and project switching, cascading deletion, SQLite and
Mindscape integrity, debug request logging, secret handling, macOS diagnostics,
performance, accessibility, and maintainability.

## Findings and resolutions

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | The floating linked-card preview did not expose the required delete action. | Added a disabled-while-busy delete control that uses the same subtree confirmation and deletion workflow as the full card and navigator. |
| P1 | Reusing the preview component for another linked card could carry its unsent draft into the new card. | Scoped draft state to `card.id` and keyed the preview instance by card ID. |
| P1 | Two sends could start before the first request emitted its `started` event. | Added an optimistic client-side card lock and an atomic single-request guard in `RequestRegistry`. |
| P1 | Native `window.confirm` was not reliably exposed by the packaged WKWebView during UI automation, allowing a delete action to continue without an accessible second step. | Replaced it with an in-app modal whose safe default is Cancel and whose separate “Delete permanently” button is the only path to the IPC call. |
| P2 | Deleting a card cleaned every pre-existing orphan Mindscape node in the project, including nodes unrelated to the deleted subtree. | Capture only Mindscape nodes touched by the subtree and delete only those that lose their final source. |
| P2 | The permanent-deletion confirmation omitted the explicit descendant count. | Added card, descendant, and message counts. |
| P2 | Floating history auto-scroll ran whenever a newly allocated `turns` array was received, even when history had not changed. | Limited scrolling to turn-count, latest-content, and latest-status changes. |
| P2 | Database coverage did not exercise the required 500-card cascade. | Added an atomic 500-card deep-subtree deletion test. |

No P0 findings were identified. No P0, P1, or P2 findings remain open.

## Security and data integrity

- SQL remains parameterized; subtree deletion and scoped Mindscape cleanup run
  in one SQLite transaction.
- Root deletion is rejected in the UI, command layer, and repository layer.
- The request registry blocks deletion during any active model request and now
  rejects concurrent model requests atomically.
- Debug logs serialize the same `serde_json::Value` passed to `reqwest`.
- Authorization headers, Keychain references, and API keys are not logged.
  Endpoint user information, query values, and fragments are redacted.
- Release builds compile the request logger as a no-output function.
- Backup schema remains v4 and no migration is required.

## Verification

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`: 60 tests passed
- `pnpm test:coverage`: statements 88.45%, branches 80.08%, functions
  92.05%, lines 90.38%
- `pnpm build`
- `pnpm audit --audit-level high`: no known vulnerabilities
- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`: 41 library tests passed; the separate binary and documentation
  test targets each contain 0 tests
- `pnpm tauri build --debug --bundles app`
- `pnpm tauri dev`: reached `Running target/debug/lattice` and remained stable
  without an exception stack or process exit
- Packaged macOS UI smoke: linked marks opened the floating card; Unicode text
  remained intact; `⌘Enter` started a follow-up; the preview stayed open,
  showed the stop state and streamed `OK`; delete controls were disabled while
  generating; reopening showed history; the in-app deletion dialog opened and
  Cancel preserved the linked card.
- Caps Lock was toggled twice and restored without an application exit or input
  fault. The automation driver cannot synthesize a real IME composition session,
  so native Chinese composition continues to rely on the user's confirmed manual
  behavior. Isolated IMK/TSM lines remain non-failing diagnostics unless paired
  with a reproducible input fault, crash, or termination stack.

During the first packaged deletion smoke, the native confirmation path continued
without exposing a cancellable dialog and removed an empty linked card. A
consistent SQLite backup was created before restoration, and the same empty
selection-linked card was recreated with its exact title, excerpt, and rendered
text range. The test-only follow-up was removed with the deleted test card and
no test message remains in the restored card.
