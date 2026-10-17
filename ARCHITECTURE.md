# Occlude architecture

## Scope and phases

Occlude turns a pasted screenshot into independent image-occlusion cards. The
interface is German. Phase 1 is a local application; no authentication or cloud
service is needed. Cloud sync, installability, and portable backups follow in that
order. Do not mistake local persistence for a complete offline PWA.

## Client

React + TypeScript + Vite render a responsive application, with Tailwind CSS for
styling. Dexie/IndexedDB is the running UI's source of truth. Live queries update
the UI after committed transactions; React holds only transient editor/view state.
The selected deck and review preferences persist locally.

Images are validated, decoded, re-encoded to WebP, hashed, and stored as Blobs in
IndexedDB. Image content is deduplicated separately from image placements, so the
same screenshot can belong to different decks without duplicating its bytes.
Each placement has stable regions; each region has exactly one stable card.
Coordinates are normalized. Image and masks share one transformed surface for
responsive scaling, zoom, and pan. Region edits retain card IDs and review logs.

`ts-fsrs` handles scheduling. Fuzz is disabled, and replay sorts immutable events
by `(reviewedAt, id)` for deterministic concurrent-event reconciliation. All FSRS
fields are retained. Day boundaries use local calendar arithmetic, including DST.
Review transactions atomically append an event and update the derived schedule.

## Planned cloud boundary

Supabase Auth establishes ownership. PostgreSQL and private Storage are the cloud
authority. A durable outbox, idempotent SQL RPC, and ordered event replay reconcile
local data; see SYNC_DESIGN.md and DATABASE.md. Credentials are not needed for
Phase 1. Never include a service-role key in the client.

## Risks and tradeoffs

- Browser storage can be evicted: Phase 1 is single-browser storage without backup.
  Request persistence, expose storage failures, and add exports in Phase 4.
- Concurrent offline reviews cannot know each other's scheduling context; replay
  preserves both answers but may change their resulting intervals.
- FSRS changes affect replay: pin the library and persist a scheduler version.
- Clock skew affects event order; document it and preserve client timestamps.
- Large images exhaust mobile memory: bound input size and dimensions before save.
- Phase 1 has no service worker; a full page reload offline requires Phase 3.

No custom server, Docker, AWS, analytics, or general note editor is needed.
