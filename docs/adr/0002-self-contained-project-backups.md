# ADR 0002: Self-contained project backups

Status: accepted

## Decision

Schema v3 JSON backups are self-contained. In addition to the core workspace and Mindscape, they
embed each managed PDF/Markdown/TXT file as base64 plus its structured chunks and citation
snapshots. Import verifies the decoded SHA-256 hash, restores files only into the managed document
directory, and writes all database entities in one transaction. On any database failure, restored
files are removed.

Schema v1 and v2 remain importable. They represent earlier core-only and Mindscape-capable backups
and naturally contain no managed documents.

## Consequences

- A backup can be restored on an empty machine without access to original source paths.
- JSON is intentionally portable and inspectable, but binary content adds about one-third encoding
  overhead. Imports are capped at 750 MB and individual source documents remain capped at 100 MB.
- API keys and model secrets are never part of the backup.
