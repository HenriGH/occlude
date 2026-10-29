# Occlude

A focused flashcard app with a German interface. Create image-occlusion or
question-answer cards, save locally, and review with FSRS. Project files live in this
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

Question-answer cards support plain text and LaTeX formulas on both sides, local
editing, folders, the same review queue and synchronized history. Under **Neu**,
choose **Frage & Antwort** instead of an image. Editing preserves the card's
schedule. Formulas use `$...$` or `$$...$$`; HTML is treated as text.
Cards can also carry one static SVG diagram per side. ChatGPT sends optional
`front_svg`/`back_svg` fields directly; the editor can import, replace or remove
SVG files. Answer graphics stay hidden until reveal. Diagrams are cached locally;
unchanged graphics are omitted from subsequent version-aware cloud snapshots.
Apply the new `202610290001_card_svg.sql` migration and redeploy the website/MCP
function using [the update guide](docs/chatgpt/SETUP.md).

An authenticated MCP integration lets ChatGPT save new cards directly into an
Occlude account after one-time connection. No model API key or manual import is
needed. With explicit expanded consent it can find questions and delete selected
cards or whole folders on the user's request. Version checks and folder previews
protect against deleting content changed since selection. Existing connections
keep creation-only access until disconnected in Occlude and explicitly reconnected.
Apply `202610200002_chatgpt_deletion.sql` and redeploy both the site and MCP function
for this update. The user reports the live creation flow works. A public directory
listing still requires the operator's submission and OpenAI's review process.
Follow [the deployment guide](docs/chatgpt/SETUP.md), with
[submission notes](docs/chatgpt/SUBMISSION.md) and a
[privacy draft](docs/chatgpt/PRIVACY-DRAFT.md) that needs operator details before
publication. This is not yet a live public listing.

Desktop sidebar folder arrows expand/collapse nested folders independently of selection;
only folders with children have an arrow. The view is remembered on this browser.
Selecting a nested folder from the dashboard reveals its ancestry in the sidebar.
Mobile uses a bottom bar with Übersicht and Bibliothek instead of the sidebar
and logo header. Bibliothek opens the top-level folders; the folder path provides
access to parent folders. Creation and settings use compact page-title actions.
Tab switches protect unsaved drafts, and the bar stays out of the way during
reviews. Safe-area padding keeps content and notifications above it. No edge
swipe handler is installed. Wide desktop windows retain the existing navigation.

During review, the image is vertically centered, answer/rating buttons sit at the
bottom above the gesture inset, and the header contains only exit and progress.
After every rating, the round refreshes from local storage: newly due cards join
the end without duplicating pending cards. Folder scope and daily new-card limits
still apply. Reviews never wait for a cloud request.

A daily streak appears as a flame and number in Übersicht and Bibliothek. The
first rated card activates the day; opening the app, revealing an answer or
creating cards does not count. Consecutive calendar days extend the streak, a
missed day resets it, and a short flame animation marks the first daily review.
The count comes from existing synchronized review history across all folders and
devices, including offline reviews after synchronization. No new cloud schema is
needed. Days follow local midnight, independently of the configurable FSRS day
boundary; devices in different time zones may therefore show different day states
near midnight. Reduced-motion settings keep the feedback static.

The mobile layout uses dynamic viewport height, safe-area insets and a standalone
web manifest with PNG icons rendered from the existing logo. Browser theme colors
follow the selected appearance, which is also applied before the app starts to
avoid a white launch flash. Installation does not yet enable offline restarts.

The page canvas, body, app root and color-scheme metadata use the selected
appearance from the first paint. The active installation manifest also follows
the app appearance, including when Occlude is dark and Android itself is light.
Both light/dark manifests keep the same app ID, scope, start URL and icons;
standalone mode keeps the system status bar. The bottom glass surface now covers
the entire web viewport, including its safe area; only the controls are inset.
Android/Chrome controls whether an installed PWA can draw behind the native
navigation bar. `viewport-fit=cover` already opts in where supported; it cannot
force a host browser to allow it. See [Android system bars](docs/android-system-bars.md)
for the distinction and the native edge-to-edge alternative.

An optional [Android app host](android/README.md) provides its own edge-to-edge
window while keeping clock/battery visible. It loads the same website, supports
image selection and Android Back, and restores account data via the existing sync.
Its APK is installed separately from the Chrome PWA.

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

Material accents give primary actions a raised edge and pressed state, with
soft satin shading on study/folder cards. Contact and diffuse shadows anchor
buttons and larger panels to the canvas. Floating controls use a restrained
frosted surface that continues through the mobile gesture inset. Masks remain opaque.
Reduced motion/transparency preferences and opaque blur fallbacks are supported.

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

The study image has no zoom toolbar or gray canvas. Pinch to zoom around the
point between your fingers; drag while zoomed to inspect the image within its
edges. Desktop trackpad pinch or Ctrl+mouse wheel zooms around the cursor. Normal
wheel input scrolls the page. Mobile slides reach the screen edges, while tall
images fit the available height. A question appears once on its mask and, after
revealing the answer, once as a small caption. Long mask questions wrap and fit
their box rather than being truncated. Website updates also apply to the Android
host after fully closing and reopening it; a new APK is not needed for this view.

Editor shortcuts: **R** draw, **V** select/move/resize, **H** pan, Delete remove the
selected mask, Ctrl/Cmd+Z undo. Use zoom controls, the wheel, or two fingers to zoom.
After drawing, the selected mask's corner handle is immediately available for
resizing. Drawing on an empty part of the image continues creating new masks.
During review, Space reveals and keys 1–4 rate. Other masks stay covered.
After reveal, Gut receives focus. Arrow keys select a rating and Space confirms;
Home/End select the first/last rating. Holding Space does not skip or rate cards.

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

Existing projects must apply only migrations not yet applied: the mask-question
migration `202610170002_mask_labels.sql`, then
`202610200001_basic_cards_chatgpt.sql` for question-answer cards and restricted
ChatGPT access. Do not rerun existing migrations. Until the backend supports the
new card type, edits stay local and queued with an update instruction.

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
