# Validation

## Phase 1

Commands run from this repository:

```sh
npm run build
TZ=Europe/Berlin npm test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
# With the build complete and no existing dev server on port 5173:
PLAYWRIGHT_USE_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Validated on 2026-10-17 with Node 24.19.0 and Chromium 154: production build passed;
20 unit/component tests passed; all 4 browser tests passed against both the Vite
development server and production preview. `npm audit --omit=dev` reported zero
known production dependency vulnerabilities. The reusable cloud setup script was
also executed successfully with a frozen `npm ci` installation.

The build type-checks TypeScript and creates a Vite production bundle. Vitest uses
fake-indexeddb for actual Dexie transactions, not mocked repository methods.
Component tests use React Testing Library. Playwright uses real Chromium and a
fresh browser context per test; it starts and stops its own Vite server.

Coverage includes:

- Exactly three cards and one image/Blob from three masks.
- Idempotent reviews, immutable event replay, equal-time event ordering, all FSRS
  fields and Dates surviving persistence, independent card scheduling.
- Atomic rollback of partially attempted creation.
- Mask edit/add/remove retaining unrelated IDs/history; undo before save.
- Descendant queries, cycle prevention, movement, cascade deletion and safe Blob GC.
- Daily new limits across decks and local calendar review boundaries including DST.
- Native Chromium clipboard paste, real mouse drawing, file upload/validation,
  mobile navigation/theme persistence, review/reveal/rating and page reload.
- Continuing reviews after network disconnection with the app already loaded.
- Normalized target alignment after resizing to mobile, zoom, and pan.

Playwright screenshots and failure traces are local ignored outputs in
`test-results/`. No test result from a different run counts as current evidence.

## Phase 2 local protocol and SQL checks

The suite now includes PGlite, an embedded PostgreSQL runtime, executing the actual
versioned migration. Auth role/JWT context and Storage metadata tables are fixtures;
RLS, policies, functions, transactions, constraints and version checks are real SQL.
Two independent Dexie databases exercise the sync engine against that SQL RPC.

Coverage includes lost acknowledgments, interrupted uploads, opposite reconnect
orders, conflicting equal-time reviews, retry persistence after reopening, lazy
image retrieval, stale metadata conflicts/rebase, explicit cloud adoption without
discarding events, tombstones and missing-target protection. A failing outbox write
must roll back the local mutation. Browser tests cover the cloud setup UI and
sign-out lock without deleting cached cards; they do not send real login emails.

Hosted Supabase checks remain blocked by the unapplied migration and this cloud
machine's proxy denial (CONNECT 403 for the project domain). The domain requirement
is saved in the environment draft. Run supabase/SETUP.md after applying it. No live
tenant-isolation, email delivery, or hosted Storage success is claimed by fixtures.

Latest Phase 2 run on 2026-10-17: build passed, all 40 unit/SQL/integration tests
passed, and all 5 browser scenarios passed against the production preview. The
development server passed the same 5 browser scenarios before the final mutex
guard; the production run validates the final code. Frozen npm ci/setup succeeded;
`npm audit --omit=dev` reports zero known production dependency vulnerabilities.

## Acceptance status after Phase 2 implementation

| Scenario | Status in Phase 1 |
| --- | --- |
| A: screenshot creates 3 independent cards / 1 image | Automated in real Chromium |
| B: multi-device sync | Independent local databases + actual SQL tested; live Supabase unverified |
| C: restart offline, review 20, synchronize once | Unimplemented; requires Phase 3; loaded-app offline review tested separately |
| D: concurrent offline reviews converge | Both orders tested against actual SQL; hosted devices unverified |
| E: nested decks | Local transactional and browser tests |
| F: mobile image geometry | Resize/zoom/pan browser test; physical iOS/pinch testing outstanding |
| G: tenant and private-image isolation | SQL RLS/Storage policy tests pass; hosted HTTP/Auth verification pending |
| H: full export/import | Unimplemented; Phase 4 |
| I: interrupted cloud operations | Local protocol + actual SQL retries tested; live transport unverified |

Production hosting, hosted Supabase services, browser installation, service-worker caching, Safari,
and physical-device performance have not been validated in Phase 1.

## Authentication recovery

EmailSignIn component tests verify project-wide error feedback, a persisted
60-second send pause across reload/recipient changes, duplicate-submit prevention,
cross-tab pause updates, code verification during a send pause, and no automatic
resend after an expired code. Error-mapping tests cover callback parameters and
SDK errors without echoing tokens or URLs. Initialization errors are inspected
explicitly because getSession alone does not surface a failed URL exchange.

`e2e/auth-recovery.spec.ts` uses the real Supabase browser SDK with intercepted
HTTP responses. It verifies code-to-session login, callback-error recovery, and a
429 mail limit across reload and email changes. Every external request is either
mocked or aborted: no login emails are sent and no live Auth success is claimed.
Hosted redirect and SMTP settings remain dashboard actions in supabase/SETUP.md.

Authentication recovery validation on 2026-10-17: build passed; all 49 automated
tests and all 7 production-browser scenarios passed. An initial browser failure
exposed the SDK's nested callback error code being replaced by a generic message;
the handler was corrected and both recovery scenarios were rerun successfully
before the complete production-browser run.

## Background sync responsiveness

Validation on 2026-10-17: production build passed, all 64 unit/component/SQL/
integration checks passed, and all 9 Chromium scenarios passed against that build.

Additional SQL/IndexedDB cases verify zero library-row writes for an unchanged
snapshot, replay limited to a card receiving new events, no-op editor saves,
persistent original-image upload markers across restarts and devices, shared
downloads, local editing/review while a push is stalled, coalesced work arriving
during a pass, automatic draining beyond 100 operations, stopping a failed batch,
and one automatic worker per shared browser database with Web Locks.

Transport tests use the real Supabase RPC client with mocked HTTP. They verify
concurrent token-verification reuse, refreshed tokens, rejection of a different
account (including a misleading local user object), retry after verification
failure, and sign-out. Request-deadline tests include stalled response bodies and
caller cancellation, as well as JSON/Auth versus longer image-transfer deadlines.

`e2e/background-sync.spec.ts` uses the real browser SDK and IndexedDB with every
external request intercepted. It holds an expired-session refresh unresolved,
then rejects it: the mobile-sized UI can still open cached cards, save masks,
rate cards, and retain the queue across another reload. Another scenario holds a
snapshot and then a push, edits again and reviews before releasing either, then
checks background delivery, no original-image upload, and persistence after reload.
Explicit sign-out still locks cached cards in the existing browser scenario.

These are functional checks under controlled network stalls, not measurements on
the user's physical phone or a hosted Supabase performance benchmark. The user
reports working live multi-device sync. The cloud agent has not independently
validated that deployment; the protocol still pulls full metadata snapshots.
App-shell restart without internet and deliberate deck downloads remain Phase 3.

## Compact interface and mobile installation

Validation on 2026-10-17: build passed; all 64 unit/component/SQL/integration tests
and all 13 Chromium browser scenarios passed against the production build.

The new UI scenarios verify that an existing library with no cards due is not
treated as a new library, and that selecting an empty folder preserves the global
card count and a route back to all cards. A second independent browser context
signs into the same mocked account, holds its first connection snapshot, checks
the recovery state, then receives the first context's cards without creating a
duplicate default folder or publishing local seed data. Shared HTTP fixtures live
in `e2e/helpers/cloud.ts`; no real login emails or hosted mutations are sent.

Pixel 7 and iPhone 13 device emulation cover installation metadata and actual PNG
icon dimensions, simulated top/bottom safe areas, portrait/landscape layout without
horizontal overflow, and the selected dark appearance before application scripts
load. Existing screenshot-paste/edit/review tests still verify mask geometry after
mobile resizing, zoom and pan. Desktop, mobile light/dark, landscape, settings and
library screenshots were inspected during the UI work.

These device profiles use Chromium, not physical Android/iOS system chrome or
Safari. Native status/navigation bars and updates to an already-installed home-
screen app still require a physical-device check after deployment. The manifest
provides standalone installation metadata; it does not add a service worker or
offline app-shell caching. No new Supabase migration is needed.

Logo refinement on 2026-10-17: build and all 13 production-browser scenarios
passed. Sidebar/mobile branding was visually checked in both appearances, including
320px and 390px widths without horizontal overflow. PNG corner alpha was checked
directly: general-purpose icons are transparent, while maskable/Apple icons have
the neutral `#f5f5f7` background. The in-app SVG keeps the original symbol geometry
and inherits the active text color; the favicon responds to the browser's scheme.

## Browser and installed-app startup contention

Validation on 2026-10-17: build passed, all 65 unit/component/SQL/integration
tests passed, and all 16 Chromium scenarios passed against the production build.

`e2e/multiple-instances.spec.ts` uses two same-origin pages and native IndexedDB
connections, not mocked database methods. It verifies concurrent startup while a
reader holds a transaction, followed by editing in one instance and live updates
in the other. A held writer exercises the six-second recovery message at mobile
width; releasing it lets the second instance render automatically with its cards
and unacknowledged edit intact. An old native v1 connection blocks the real v2
upgrade, triggers the immediate browser-tab guidance, then closes so startup can
complete with the original deck preserved. External HTTP requests are aborted.
The database unit suite also checks simultaneous first-launch seeding through
two independent connections, producing exactly one default workspace.

Ordinary concurrent starts did not reproduce the user's phone-specific stall.
These tests cover controlled storage contention and recovery in Chromium; actual
Android browser/installed-app lifecycle behavior and Safari require a device
check after deployment. A slow-start message is conditional because a delayed
local read alone cannot identify which process, if any, holds up storage.

## Mask questions and white default icons

Validation on 2026-10-17: build passed; all 72 unit/component/SQL/integration
tests and all 18 Chromium browser scenarios passed against the production build.

Local transaction tests cover label-only edits, whitespace normalization,
unchanged-save no-ops, invalid text and explicit removal, preserving card IDs,
schedules and immutable review events. Component checks ensure only the current
mask's question is shown during review and markup in labels remains plain text.
Actual PostgreSQL tests upgrade a populated initial schema without losing its
deck/card/review, validate labels atomically, preserve omitted text for old clients,
and enforce the existing tenant boundary. Two independent databases synchronize
offline label edits and removal through the SQL RPC without another image upload.
An old-backend fixture proves labelled work stays queued until support appears.

`e2e/mask-questions.spec.ts` adds mobile editing, save/reload, question/reveal and
removal checks. The review screenshot was visually inspected. Browser and every
installation icon are decoded into a canvas in both system appearances; their
white contour, pale-green mark and neutral dark background are checked directly.
PNG generation uses `scripts/generate-icons.mjs` and the default white SVG. The
new asset URLs include a version query so clients can fetch the revised icons.

The migration has only been applied to local PostgreSQL fixtures. An existing
Supabase project needs `202610170002_mask_labels.sql` run once as described in
supabase/SETUP.md. Physical launcher icon-refresh behavior remains OS-dependent;
no hosted deployment or dashboard update is claimed by these checks.
