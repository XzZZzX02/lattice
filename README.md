# Lattice

Lattice is a macOS-first, local-first AI workspace for non-linear conversations.

## Development

This repository uses pnpm 11.9.0 exclusively. With the Node.js installation
already active in your shell, enable the Corepack shim once:

```bash
corepack enable
corepack install --global pnpm@11.9.0
pnpm --version
```

Then install dependencies and start the desktop app:

```bash
pnpm install
pnpm test
pnpm build
pnpm tauri dev
```

Project content is stored locally. Model credentials are never written to the project database.

## ChatGPT browser extension

The optional Chrome/Edge extension keeps ChatGPT's native conversation, composer,
citations, files, tools, and conversation branches, and adds Lattice presentation
and organization. It has no model backend or API-key configuration.

Version 0.3.3 centers on a reference-anchored conversation tree: select a term,
continue a native ChatGPT branch in a floating card, and click the underlined
quote to reopen it. Returning to the main conversation dismisses the card while
retaining its draft and context. Nested branches, excerpts, notes and mind maps
remain available. The sidebar uses an expandable tree of main-line answers,
quoted branches and child branches, with ancestor-preserving search.
The header theme button switches between Lattice's existing dark palette and
the native ChatGPT appearance, following its light/dark setting and remembering
the choice locally.

```bash
pnpm extension:build
```

Load `dist-extension/` as an unpacked extension. A ready-to-extract archive is also
written to `artifacts/lattice-chatgpt-extension.zip`. See
[installation, features, and compatibility limits](extension/README.md).

For the local compatibility fixture (no ChatGPT account or model calls):

```bash
pnpm extension:dev
```

Open `http://127.0.0.1:1421/`. This fixture exercises the same UI and DOM adapter;
its native menus and extension storage are simulated.

## macOS input-service diagnostics

On macOS, the development terminal can occasionally print isolated messages such as:

```text
error messaging the mach port for IMKCFRunLoopWakeUpReliable
TSM AdjustCapsLockLEDForKeyTransitionHandling - _ISSetPhysicalKeyboardCapsLockLED Inhibit
```

These messages come from macOS input services rather than Lattice's Rust or web
application code. They were observed on macOS 26.5.2 arm64 with Tao 0.35.3 while
the application, Chinese input, Caps Lock, keyboard shortcuts, and floating-card
input continued to work normally. In that situation they are diagnostic noise
and do not make a smoke test fail.

Do not globally filter or redirect stderr to hide them: doing so could also hide
real Rust, Tauri, database, or model-provider failures. Escalate the messages as
a platform defect only when they coincide with one of the following:

- the Lattice process exits or macOS reports a crash;
- a complete exception or native termination stack is present;
- Chinese input stops working;
- Caps Lock has a reproducible behavioral problem.

Tauri's macOS window stack uses Tao/Wry and WKWebView. Known keyboard crashes are
accompanied by an explicit termination stack, unlike the two isolated lines
above. See the [Tauri architecture](https://github.com/tauri-apps/tauri) and a
[related keyboard crash fix in winit](https://github.com/rust-windowing/winit/pull/4024).

To collect a complete diagnostic log, run this from the repository root, reproduce
the issue, and stop the app with `Ctrl+C`:

```bash
mkdir -p diagnostics
{
  date
  sw_vers
  uname -m
  node --version
  pnpm --version
  rustc --version
  cargo tree --manifest-path src-tauri/Cargo.toml -i tao
  RUST_BACKTRACE=full pnpm tauri dev
} 2>&1 | tee "diagnostics/lattice-macos-$(date +%Y%m%d-%H%M%S).log"
```

Debug builds intentionally print complete model request bodies. Review and redact
the captured file before sharing it because prompts and retrieved document text
may be sensitive; API keys and authorization headers are never included by the
request tracer. Diagnostic logs under `diagnostics/` are ignored by Git.
