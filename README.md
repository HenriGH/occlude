# Occlude

A focused image-occlusion flashcard app with a German interface. Paste a lecture
screenshot, draw masks, save, and review with FSRS. Project files live in this
repository, `/workspace/occlude` in the cloud environment.

**Current milestone: Phase 2 integration, pending hosted Supabase validation.** The
local MVP is tested. Passwordless login, transactional sync, the migration, and
local SQL/security tests are implemented. Apply the migration and configure Auth
using [supabase/SETUP.md](supabase/SETUP.md) before connecting an account. Installable
offline PWA support and ZIP backups remain planned phases.

## Run

Use Node 24.19 (see `.node-version`; minimum Node 22.12) and npm.

```sh
cd /workspace/occlude
npm ci
npm run dev
```

On a normal clone, use its own checkout directory instead. The cloud sandbox has
a read-only home directory: use `npm --cache /tmp/occlude-npm-cache ci` there.
No environment variables, accounts, Docker, or external services are needed for
local-only use. For cloud sync, copy `.env.example` to `.env.local` if that file
does not exist, then follow the Supabase setup instructions. Both example values
are public browser configuration; never supply an elevated secret key. HTTPS or a
loopback address is required for browser clipboard/crypto APIs.

```sh
npm run build
npm test
# If a compatible Chromium is already installed:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
# Otherwise install Playwright's pinned browser once:
npx playwright install chromium
npm run test:e2e
```

`npm run preview` serves the production build. See TESTING.md for tested coverage
and gaps. The app does not have a service worker in Phase 1.

## Use

1. Select or create a deck. The selected deck persists between creations.
2. Paste a screenshot with Ctrl/Cmd+V anywhere outside a text field, drop a file,
   or choose a PNG/JPEG/WebP file (maximum 15 MB, 20 megapixels).
3. Draw rectangles. Every rectangle becomes a card. Save once, or Ctrl/Cmd+Enter.
4. Select **Lernen** or **Jetzt lernen**, reveal, and rate Nochmal/Schwer/Gut/Einfach.

Editor shortcuts: **R** draw, **V** select/move/resize, **H** pan, Delete remove the
selected mask, Ctrl/Cmd+Z undo. Use zoom controls, the wheel, or two fingers to zoom.
During review, Space reveals and keys 1–4 rate. Other masks stay covered.

Click a saved image to edit its masks. Moving an existing mask preserves its card
ID and history. Removing a mask removes that target's local history. Image options
move all its cards together; decks support nesting, renaming, moving, and confirmed
deletion. Parent-deck review includes descendants exactly once.

Settings include a daily new-card limit (across all decks), local-time day boundary,
light/dark/system theme, and a persistent-storage request.

## Local data and limitations

Images and review history are stored explicitly in IndexedDB. A loaded app can
create cards and record reviews without connectivity. Reloading a completely
offline app shell is a Phase 3 feature. Phase 1 data belongs to this browser
profile until you explicitly connect it to an account. Once configured, connected
workspaces queue changes durably, synchronize with Supabase, and retain local
review history. Export/backup is still pending. Keep original screenshots and do
not clear website data while changes are pending. Storage persistence is
browser-dependent. See SYNC_DESIGN.md for account locking and conflict behavior.

The scheduler is pinned to ts-fsrs 5.4.2 with fuzz disabled. Immutable events are
ordered by UTC timestamp then event ID and schedules are replayed deterministically.
SQL and independent-device integration tests establish local protocol behavior;
hosted multi-device behavior still requires the deployment checks in SETUP.md.

## Supabase setup boundary

The public project configuration is provided in `.env.example`. The remaining
required action is applying the migration and enabling email authentication:

1. Create a Supabase project; record the project URL and **publishable/anon** key
   from its API settings. Never use a service-role key in the frontend.
2. Supply public client configuration as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` through environment settings or a local ignored
   `.env.local`. The app validates these settings before building or starting.
3. Enable email authentication. Allow its development
   origin and final Cloudflare Pages HTTPS origin in Auth redirect settings. Use
   test accounts for automated isolation and device-sync tests.
4. Apply `supabase/migrations/202610170001_initial_sync.sql` to the chosen project, then
   run RLS, private-storage, and sync-recovery acceptance checks. No migrations
   have been applied to the hosted project by the agent. See the exact dashboard
   steps and Ubuntu commands in [supabase/SETUP.md](supabase/SETUP.md).

## GitHub and a hosted website

Publishing a Codex environment saves its prepared filesystem and configuration.
It does not commit or push source changes to GitHub, and it does not deploy a
website. The source repository is `HenriGH/occlude`, on branch `main`.

To give this Phase 1 app a public HTTPS address with Cloudflare Pages:

1. In Cloudflare, create a Pages project and connect `HenriGH/occlude`.
2. Select production branch **main**, framework preset **Vite**, and repository
   root (leave the root-directory field empty).
3. Use build command **npm run build** and output directory **dist**.
4. Set build environment variable **NODE_VERSION=24.19.0** if necessary.
5. Deploy and open the HTTPS URL Cloudflare provides. No Supabase configuration
   is required for Phase 1. Browser data belongs to that website's origin and
   will not transfer automatically from a development address.

A restored cloud environment needs its development server started again. Its
loopback address is for internal validation; the onboarding UI does not supply
a hosted web preview. No Cloudflare deployment has been performed or verified.

See ARCHITECTURE.md, DATABASE.md, SYNC_DESIGN.md, and IMPLEMENTATION_PLAN.md.
