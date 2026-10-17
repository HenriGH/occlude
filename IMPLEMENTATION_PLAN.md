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

- [ ] Provision Supabase project and public client configuration
- [ ] Email authentication, migrations, validated transactional RPC and RLS
- [ ] Private image storage, durable outbox, retry/recovery/tombstones
- [ ] Canonical event replay and multi-device convergence
- [ ] Two-user security and interrupted-operation tests

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

Next is Phase 2. Supply an actual Supabase project URL and publishable/anon key via
environment settings; see README.md. No cloud synchronization, RLS/storage security,
full offline PWA restart, or export/import acceptance is claimed yet.
