# ADR 0001: Local-first Tauri architecture

React owns presentation and transient interaction state. Rust owns persistence, credentials, model I/O, imports, and exports. SQLite is the source of truth. This boundary keeps secrets out of the WebView and makes recovery behavior testable.
