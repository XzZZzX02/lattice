# ADR 0003 — Persistent selection-to-card links

## Decision

Selections that create a child card are stored separately from quotes in
`selection_card_links`. A link records its source Turn, target Card, selected
visible text, rendered UTF-16 offsets and creation time.

Card creation and link insertion share one SQLite transaction. A unique
constraint on `(source_turn_id, start_offset, end_offset)` guarantees that one
exact rendered range can create at most one card. The UI enters the new child
card immediately.

## Rationale

Quotes are temporary composer context and receive a target Turn only when a
message is sent. A selection-to-card link is permanent navigation metadata and
must survive restarts and project backup. Keeping the two concepts separate
avoids changing context-builder behavior.

Rendered UTF-16 offsets match browser Selection offsets and remain stable across
Markdown syntax such as emphasis. Quotes use the same rendered coordinate
system, so a selection that crosses Markdown elements can still be added to the
composer. The selected text is retained as a validation and fallback snapshot.

## Consequences

- Project workspace responses include all selection-to-card links.
- Project backup schema version 4 includes and remaps these links; versions 1–3
  import with an empty link set.
- Deleting the source Turn or target Card removes the link by foreign-key
  cascade.
