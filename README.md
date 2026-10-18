# Occlude

A focused image-occlusion flashcard app with a German interface. Paste a lecture
screenshot, draw masks, save, and review with FSRS. Project files live in this
repository, `/workspace/occlude` in the cloud environment.

**Current milestone: Phase 2 integration with background synchronization.** The
local MVP is tested. Passwordless login, transactional sync, the migration, and
local SQL/security tests are implemented. The user reports working live multi-device
sync; automated validation uses local SQL and mocked HTTP. For a new project, apply the migration and configure Auth
using [supabase/SETUP.md](supabase/SETUP.md) before connecting an account. Home-screen
installation metadata is included; offline app-shell caching and ZIP backups remain
planned phases.

The interface uses system typography, a compact study summary, and light/dark
appearances. New installations default to dark, including the first paint on a
light OS. Saved light/dark/system choices remain unchanged. Desktop pages use
their main title without an extra header or sync indicator; sync details are
available in settings while synchronization runs in the background.
An existing library with no cards due remains an existing library;
an unconnected account or first cloud pull shows a recovery state without a
first-card prompt. Cached content stays available during synchronization.

Desktop sidebar folder arrows expand/collapse nested folders independently of selection;
only folders with children have an arrow. The view is remembered on this browser.
Selecting a nested folder from the dashboard reveals its ancestry in the sidebar.
Mobile uses a bottom bar with Übersicht and Bibliothek instead of the sidebar
and logo header. Bibliothek opens the top-level folders; the folder path provides
access to parent folders. Creation and settings use compact page-title actions.
Tab switches protect unsaved drafts, and the bar stays out of the way during
reviews. Safe-area padding keeps content and notifications above it. No edge
swipe handler is installed. Wide desktop windows retain the existing navigation.

The mobile layout uses dynamic viewport height, safe-area insets and a standalone
web manifest with PNG icons rendered from the existing logo. Browser theme colors
follow the selected appearance, which is also applied before the app starts to
avoid a white launch flash. Installation does not yet enable offline restarts.

The page canvas, body, app root and color-scheme metadata use the selected
appearance from the first paint. The active installation manifest also follows
the app appearance, including when Occlude is dark and Android itself is light.
Both light/dark manifests keep the same app ID, scope, start URL and icons;
standalone mode keeps the system status bar. Android/Chrome still controls the
native navigation area and may retain old colors until its installed-app metadata
updates. A page theme switch cannot force an immediate native APK update.

The default logo uses the white outline and pale-green occlusion mark. Browser
and installation icons use this version on a neutral dark background for contrast
on any home screen. In-app branding still follows the selected light/dark
appearance. Transparent vector exports are `public/logo.svg` and
`public/logo-light.svg` (white outline), plus `public/logo-dark.svg` (dark outline).
Run `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/generate-icons.mjs`
to regenerate the installation PNGs from the default SVG.

The logo's pale green (`#bde287`) is the shared accent for the wordmark dot,
primary actions, selected tools and occlusion masks. Light surfaces use darker
green for small action text and focus rings; dark surfaces use the pale accent.
The surrounding interface keeps its neutral light/dark appearance.

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
3. Draw rectangles. Every rectangle becomes a card. Select a mask to add an optional
   question (up to 200 characters). It appears on the mask and above the image during
   review. Save once, or Ctrl/Cmd+Enter.
4. Select **Lernen** or **Jetzt lernen**, reveal, and rate Nochmal/Schwer/Gut/Einfach.

Editor shortcuts: **R** draw, **V** select/move/resize, **H** pan, Delete remove the
selected mask, Ctrl/Cmd+Z undo. Use zoom controls, the wheel, or two fingers to zoom.
After drawing, the selected mask's corner handle is immediately available for
resizing. Drawing on an empty part of the image continues creating new masks.
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

The current hosted origin is `https://occlude.henschau2005.workers.dev/`. The app
supports direct numeric email-code login as well as links. For invalid-link or
mail-limit errors, follow the production redirect, code-template and custom SMTP
steps in [supabase/SETUP.md](supabase/SETUP.md). The built-in test sender's quota
cannot be increased by changing frontend code.

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
4. Apply the SQL files in `supabase/migrations/` in filename order, once each, then
   run RLS, private-storage, and sync-recovery acceptance checks. No migrations
   have been applied to the hosted project by the agent. See the exact dashboard
   steps and Ubuntu commands in [supabase/SETUP.md](supabase/SETUP.md).

Existing projects with working sync only need the new
`supabase/migrations/202610170002_mask_labels.sql` migration for mask questions.
Until then, labelled edits stay local and queued; the app reports the missing
update rather than letting an old server silently drop the text.

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
