# Implementation checklist

## Phase 1 — local functional MVP

- [x] React/TypeScript/Vite + Tailwind; German responsive light/dark interface
- [x] Transactional Dexie persistence, UUIDs, normalized masks, deduplicated Blobs
- [x] Nested decks, hierarchy validation, rename/move/confirmed delete
- [x] Paste/drop/upload, rectangular editor, edit/add/delete masks preserving IDs
- [x] Independent ts-fsrs schedules and immutable deterministic event history
- [x] Parent-deck review, reveal/rate, daily preferences/statistics
- [x] Unit/component tests and real-browser screenshot-to-review test

## Phase 2 — cloud synchronization

- [x] Project URL and public client configuration; secret keys excluded
- [x] Email authentication UI, migrations, validated transactional RPC and RLS code
- [x] Private image storage integration, durable outbox, retry/recovery/tombstones
- [x] Canonical event replay and two-independent-database convergence tests
- [x] Local PostgreSQL two-user security and interrupted-operation tests
- [ ] Apply migration to hosted Supabase and configure Auth redirect URLs
- [ ] Verify real email login, Storage HTTP behavior and two physical devices
- [ ] Verify hosted two-user access isolation and lost-ack recovery

## Phase 3 — offline PWA

- [ ] Manifest/icons/Workbox app-shell precache and installation
- [ ] Explicit deck download, verified assets and progress
- [ ] Quota/eviction handling and mobile gesture validation
- [ ] Restart offline and review 20 cards, then synchronize once

## Phase 4 — production hardening

- [ ] Validated versioned ZIP import/export with complete round-trip tests
- [ ] Security/performance/mobile acceptance tests
- [ ] Cloudflare Pages configuration and deployment verification
- [ ] Backup/recovery documentation and final acceptance A–I

Each phase must run and pass its own checks before moving on. Do not claim the
entire product is production-ready while later phases remain unchecked.

## Phase 1 completion report — 2026-10-17

Implemented the local editor/review workflow, transactional persistence and deck
management in `src/`; build configuration and locked dependencies at the repository
root; 20 unit/component tests and 4 Chromium browser scenarios in `src/` and `e2e/`.
The original product brief is preserved in `docs/PROJECT_BRIEF.md`. Architecture,
schema, sync design, usage and validation documents are maintained at the root.

The production build, all 20 unit/component tests, and all 4 E2E scenarios passed.
E2E scenarios passed against both development and production preview servers. The
cloud setup script passed including npm ci. No cloud service or deployment was
used. All generated outputs are ignored. Project source is maintained on the
GitHub repository's main branch; environment publication and Git pushes are
separate operations. See README.md for static hosting setup.

Phase 1 required no cloud service; its initial completion did not claim live
cloud synchronization, full offline PWA restart, or export/import acceptance.

## Phase 2 implementation report — 2026-10-17

Implemented `src/sync/`, the cloud settings UI, version-2 Dexie outbox/meta stores,
transactional mutation integration, account locking, private lazy image retrieval,
and `supabase/migrations/202610170001_initial_sync.sql`. Setup is documented in
`supabase/SETUP.md`. Only the supplied public client settings are retained.

Local SQL tests exercise RLS, RPC privileges, immutable events, operation
idempotency, cross-user FK rejection, storage ownership and geometry validation.
Independent-device tests use the actual SQL RPC and separate Dexie databases,
including both offline reconnect orders, interrupted image uploads, lost
acknowledgments, metadata conflict resolution and preservation of deleted-target
history. These do not claim hosted Supabase Auth/Storage have been validated.

Validation: build passed; 40 unit/SQL/integration tests and 5 production-browser
scenarios passed. The setup script completed a frozen installation and checks.

Remaining external boundary: apply the migration in Supabase SQL Editor, configure
email redirects, and verify with real accounts. The current cloud machine's
network proxy denied the project hostname (CONNECT 403); the necessary domain and
public variable requirements are saved in the environment draft. Phase 3 remains
pending until live Phase 2 checks complete.
