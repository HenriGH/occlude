# Validation

## Question-answer cards and public ChatGPT integration

Validated on 2026-10-20 with Node 24.19.0 and Chromium: production build passed,
all 98 unit/component/SQL/integration tests passed with
`TZ=Europe/Berlin npm test -- --maxWorkers=2`, and all 45 browser scenarios passed
against the production preview. `npm audit --omit=dev` found zero vulnerabilities.
The Supabase function also passed Deno type-checking and the local MCP runtime
smoke script documented in [ChatGPT setup](docs/chatgpt/SETUP.md).

New coverage exercises local question-answer creation/editing, plain text and safe
LaTeX rendering, offline answers, draft protection, long mobile text, mixed image/
text review rounds, unchanged scheduling/history after edits and shared streaks.
Browser fixtures verify background arrival without import, OAuth login/approval/
denial/callback, clickjacking protection and capability-before-grant revocation.
Mobile dark and desktop light rendering were also visually inspected.

Actual migration SQL is exercised with PostgreSQL and independent IndexedDB
devices, including an MCP request creating cards that both devices synchronize.
Tests cover old-client compatibility, retained local cards before backend upgrade,
atomic batches, retry deduplication, card-type immutability, forged ownership,
cross-account isolation, OAuth table/Storage/RPC restrictions and immediate
revocation. MCP tests use the official client and cryptographically signed JWTs,
rejecting altered, expired and wrong-project/client claims.

No hosted migration/function deployment, real ChatGPT tool invocation or public
directory approval is claimed by these tests. Those remain operator checks in
[the deployment guide](docs/chatgpt/SETUP.md). All browser external HTTP is mocked
or blocked; no real mail, private library reads or cloud writes are performed.

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

## Collapsible folder navigation

Production build, all 72 unit/component/SQL/integration checks and all 20 Chromium
browser scenarios passed after this change. `e2e/deck-navigation.spec.ts` creates
three hierarchy levels through the real folder UI, checks independent nested
collapse, leaf folders without toggle buttons, keyboard Space/Enter activation,
and unchanged selection while a parent is collapsed. Reload preserves the folded
view even when the selected folder is inside it. Selecting a hidden descendant
from the dashboard reveals its ancestors. The responsive check switches to the
mobile bottom bar and back to the desktop sidebar without losing that selection.
The desktop capture was visually inspected.
Expansion is a local browser preference and does not enqueue cloud operations.

## Bottom safe area and native navigation colors

Production build, all 72 unit/component/SQL/integration checks and all 23 Chromium
browser scenarios passed. `e2e/mobile-system-bars.spec.ts` uses Pixel 7 and iPhone
13 profiles with Chromium's `Emulation.setSafeAreaInsetsOverride`, providing real
browser `env(safe-area-inset-*)` values (24px top / 34px bottom). It checks that
standalone mode and app identity stay unchanged and that the active installation
manifest follows the app appearance, including dark Occlude on a light OS. Both
manifest variants must retain identical IDs, scope, start URL and icons.

The new scenarios switch between light/dark within a light OS profile, scroll
settings to the bottom, and decode actual viewport screenshots to verify the
bottom 34px of the page canvas. Dark reloads hold application scripts so the same
pixel check exercises bootstrap painting before React and IndexedDB are ready.
Review/reveal checks also keep the rating buttons above the emulated safe area.
The dark mobile capture was visually inspected. No live Auth requests are sent.

These are page-canvas checks, not screenshots of Android's native gesture bar.
Chromium's installed-app code can source a fitted navigation bar from installation
colors instead of the live page theme color; see
[WebappIntentDataProvider](https://github.com/chromium/chromium/blob/main/chrome/android/java/src/org/chromium/chrome/browser/webapps/WebappIntentDataProvider.java)
and
[CustomTabNavigationBarController](https://github.com/chromium/chromium/blob/main/chrome/android/java/src/org/chromium/chrome/browser/customtabs/features/CustomTabNavigationBarController.java).
The user chose to retain the status bar, so fullscreen is not requested. Android
may cache old installation colors until its installed-app metadata updates. The
page cannot force an immediate native APK update, and browser versions differ in
support for coloring fitted native bars. A physical installed-app check after
deployment is still needed; these tests do not claim control over pixels outside
the web viewport.

The full browser run also exposed an initial seed race: upload actions could
appear while the initial preferences/default-folder transaction was still
pending. The library query now reads its metadata in one read-only transaction
and returns no ready workspace until preferences exist. A real held reader on
an unseeded database checks that upload stays unavailable, the slow-start help
appears, and releasing the reader completes initialization automatically. Cached
workspaces still open while another reader is held; no Auth/cloud wait is added.

## Mobile bottom navigation

Production build, all 72 unit/component/SQL/integration checks and all 27 Chromium
browser scenarios passed with the new mobile navigation.

`e2e/mobile-navigation.spec.ts` checks Pixel 7 and iPhone 13 profiles with native
browser safe-area emulation (24px top / 34px bottom). Exactly two bottom actions,
Übersicht and Bibliothek, replace the mobile sidebar and logo header. The library
entry opens all top-level folders; tests create nested folders through the real
UI, return through the folder path, and re-tap Bibliothek to reach the root.
Long folder paths reveal the current folder without scrolling the document.
Settings and creation remain accessible through compact heading actions.

The tests switch themes, scroll settings to the end, check the last action and
notifications stay above the bar, and exercise the 320px layout. Existing
safe-area screenshot pixel checks still cover light/dark, cold launch and review.
Landscape mobile layouts use the bar; resizing to a wide desktop restores the
sidebar, its folder expansion and current selection. Mobile light/dark captures
were visually inspected. No custom edge-swipe handler remains.

Editor checks use trusted Chromium `Input.dispatchTouchEvent` drawing, panning
and pinch input, plus normal control clicks between raw touch sequences. Both
tabs must preserve an unsaved draft when its discard dialog is dismissed.
Accepting discard leaves the saved cards untouched; a subsequent edit/save adds
a card normally. Reviews hide the bar, keep answer buttons above the safe area,
and restore the tabs when exited. All external HTTP requests are mocked/aborted.
These are Chromium mobile profiles, not physical-device or Safari checks.

## Dark default and desktop header removal

Production build, all 72 unit/component/SQL/integration checks and all 27 browser
scenarios passed. The two cold-start scenarios passed on rerun after correcting
a request-interception race in their new startup gate.

The safe-area scenarios now hold app scripts on a fresh launch with a light OS
and verify a black first paint, dark color-scheme metadata and the dark manifest
before React/IndexedDB load. Settings must then show Dunkel selected. Choosing
Hell and reloading preserves the saved choice and the light manifest; the
existing cold dark reload and bottom-pixel checks remain in place. Light-mode
visual scenarios choose Hell explicitly instead of relying on the old default.

The desktop library check verifies that the extra header and its sync-status
button are absent and that the main title occupies the recovered space. Existing
background-sync scenarios still exercise editing, saving and review while Auth,
pulls and pushes stall, then verify queued work drains successfully. Sync details
remain available in settings.

## Material accents

Build and the 10 existing minimal-UI, mobile-navigation and system-bar scenarios
passed. This first version kept the gesture inset solid; the continuous-surface
revision below replaces that fill. The navigation theme check reads the page
canvas because the bar itself is translucent.

Seeded desktop/mobile captures were reviewed in both appearances. A browser
check sampled the three primary-button gradient colors against its text color
(minimum 9.34:1), verified the keyboard focus outline, and confirmed no button
translation with reduced motion. Emulating reduced transparency produced an
opaque surface with no backdrop filter. Blur is limited to floating controls;
study images and occlusion masks keep their existing opaque rendering. This
change adds CSS only, with no animation loop, assets or runtime dependencies.

## Stronger depth and a continuous gesture-area surface

Build and 10 existing UI/mobile scenarios passed, including rerunning the two
safe-area cases after correcting a fractional-pixel seam at DPR 2.625. Button
contact/diffuse shadows and larger panel shadows were visually reviewed on
seeded desktop/mobile pages in both appearances.

The navigation pixel check now places a contrasting uniform backdrop behind the
bar and compares an unobstructed vertical pixel strip through the bottom 34px
with the material above that inset. A
separately filled inset or an uncovered final pixel fails this check. The cold
bootstrap and review scenes still check the page background because no navigation
bar is present there. Icon clearance, theme persistence and standalone metadata
remain covered by the existing scenarios. This is web-viewport validation, not
a physical Android system-bar test; [support evidence and limits](docs/android-system-bars.md)
are documented separately. A native wrapper has not been built or deployed.
# Android host and whole image-tile elevation (18 October 2026)

The complete image tile now has a surrounding shadow and a continuous raised rim
painted above both thumbnail and caption. The thumbnail has solid satin shading;
the screenshot/image and masks remain unobscured. Seeded mobile and desktop views
were inspected in both appearances, and keyboard activation of a thumbnail still
opens the editor.

The optional `android/` WebView host controls its own edge-to-edge window, visible
system bars, safe/keyboard insets, theme icon appearance, file selection and Back.
Its origin-restricted document-start script is tested directly in Playwright.
The Back test waits for the current-folder breadcrumb before issuing Back;
without this wait it raced the asynchronous IndexedDB folder selection.

Verified locally: production web build; all 72 unit/component/SQL/integration
tests; 13 selected browser scenarios (Android host, local workflow, mobile
navigation and safe-area appearance); Android `assembleDebug`, `lintDebug` and
`assembleDebugAndroidTest`; the generated preview APK's SHA-256 and APK signature.

Native screenshot execution remains unverified. The initial connected-test
attempt ran **zero tests**: the software-emulated Android 16 guest had not started
its package service, so installation failed before the app or tests could run.
This cloud machine has no `/dev/kvm`; its guest did not reach a usable boot state.
The CI workflow provisions an accelerated emulator, but its result is not claimed
from the presence of the workflow file. A physical Pixel 10 check is still needed.
The separately installed APK does not change the existing Chrome PWA window or
inherit its local storage/auth session; account sync supplies existing cards.

## Minimal study image and focal zoom

Review now uses an unframed, aspect-ratio-sized image without its zoom toolbar or
duplicate question heading. On mobile the image extends across the content
gutters to the screen's safe edges; very tall images fit the available height.
The current mask's question wraps and fits its box. After reveal, the mask is
removed and the question appears once as a small caption. Generic instructions
above the image are removed.

Pinch keeps the image coordinate under the moving midpoint of both fingers.
Zoom and translation update together using the latest gesture state. Review
panning is bounded by the image edges and disabled at normal size. Lifting one
finger continues the pan with the remaining finger. Ctrl+wheel/trackpad pinch
anchors desktop zoom at the pointer; ordinary wheel scrolling remains available.
Reveal preserves the view and a new card starts at normal size. Resize clamps the
view to its new bounds. Editor tools, drawing, immediate resizing and undo remain
covered by the existing local and touch workflows.

`e2e/review-image.spec.ts` exercises real Chromium/CDP multi-touch under Pixel 7
and iPhone 13 emulation, checks off-center image coordinates before/after pinch,
one-finger handoff, image-edge coverage, zoom reset, reveal and desktop wheel
anchoring. Question tests check a single visible copy, fitted text, persistence
and removing the question. Fixtures wait for editor/save completion before Back
or reload. Mobile/desktop light and dark captures were visually inspected.
Production build, all 72 existing tests and 18 selected browser scenarios passed.
These browser profiles do not constitute a new physical-device gesture test. The
user has separately reported that the Android APK from the previous change works.

## Live review rounds and focused layout (2026-10-18)

The active queue refreshes from a consistent IndexedDB snapshot after each rating
or skip. Pending order is retained; newly due repeats are appended once, scoped to
the folder captured at session start. Daily new-card limits still apply. Deleted,
moved, rescheduled and skipped cards do not keep reappearing. A refresh failure
advances past the persisted rating, so retrying cannot accidentally rate it twice.
No cloud fetch is involved and future-due cards do not delay completion.

Four new database tests cover due-time boundaries, tail ordering/deduplication,
subtree/global scope, movement/deletion, daily introductions and skips.
`e2e/review-session.spec.ts` advances the browser clock to a real persisted FSRS due
time while offline and verifies that the repeated card joins the same round before
completion, with three persisted reviews for two cards. It also checks image
centering through reveal/rotation, accessible progress, a text-free header, fixed
bottom actions, safe insets and no page overflow. The mobile navigation fixture
reapplies safe-area emulation after attaching a second CDP session; otherwise
Chromium resets its emulated inset to zero. Question coverage checks that the
caption remains readable above the ratings.

Production build and all 76 unit/component/SQL/integration tests passed (Vitest
with `--maxWorkers=2` avoids CPU contention during PGlite startup). All 20 selected
browser scenarios passed, covering review, focal pinch zoom, local workflows,
mobile navigation/system bars and the Android host bridge. The seven review/image/
question scenarios were rerun after the final caption and landscape adjustments.
Mobile/desktop dark captures and landscape question/answer layouts were inspected.
These are Chromium checks, not a new physical-device test. The existing Android
host loads the updated website; these changes do not require another APK.

## Daily study streak (2026-10-19)

The streak is derived from retained review events across the whole workspace,
not a per-device counter. One or more ratings on a calendar day count once; mere
login, card creation and answer reveal do not. Yesterday's streak remains gray
until today's first review; a missed full day resets the count. Local calendar
dates handle DST, leap days and year changes, independently of the FSRS learning-
day boundary. Dates use the current device's timezone; no account timezone is
introduced. Old history is included automatically and future events are ignored.

The first-daily-review check uses the existing reviewedAt index inside the local
rating transaction, so simultaneous tabs and idempotent retries do not duplicate
feedback. The full streak is read only for that first daily rating. The badge
uses the already cached history, with no new network calls, migrations, rewards
or blocking dialogs. A finite CSS flame/ember animation dismisses itself and
passes pointer events through; reduced-motion preference disables the animation.
Returning to a visible page refreshes day-dependent state without a cloud wait.

Five domain cases cover empty/duplicate/future histories, gaps, midnight,
interleaved device histories, DST and year/leap boundaries. A database test checks
concurrent first ratings and retries. Actual PostgreSQL RPC integration merges
three days from two offline devices, verifies same-day deduplication, retained
streaks after deleting cards, and isolation from another account.

Three browser scenarios verify actual ratings versus reveal/create, instant
offline feedback, continuing to the next card during the animation, persistence
without replaying feedback on reload, midnight/missed-day transitions, static
reduced-motion feedback, a 320px mobile header and historical cloud restoration.
All external HTTP is mocked or blocked; no real login emails or cloud writes.

Verified: production build, all 83 unit/component/SQL/integration tests
(`TZ=Europe/Berlin npm test -- --maxWorkers=2`), and 25 selected Chromium scenarios
against the production preview, including background sync, review queue/zoom,
mobile navigation/system bars, mask questions and Android host integration.
Mobile dark/light (including 320px), desktop dark, gray/active badges and the
animation were visually inspected. Physical-device animation testing was not
performed. The Android host loads the updated website; no new APK is necessary.
