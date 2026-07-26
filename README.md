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
