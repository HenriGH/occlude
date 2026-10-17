# Project: Occlude — Local-First Image Occlusion Flashcard PWA

You are a senior full-stack engineer, software architect, and product designer.

Build a production-quality, minimal, personal flashcard application focused exclusively on image occlusion flashcards and spaced repetition.

The app is intended for one university student who creates flashcards from screenshots of lecture slides on a laptop and reviews them primarily on a smartphone.

**Core product principle: Minimize the time and number of interactions required to turn a screenshot into reviewable flashcards.**

Do not build a Notion clone, note-taking app, general-purpose knowledge management system, or AI study assistant.

The product must be a responsive, installable, offline-capable Progressive Web App (PWA), synchronized across devices through a managed cloud backend.

## 1. Technology stack

Use:

- React, TypeScript, Vite
- Tailwind CSS
- vite-plugin-pwa and Workbox
- Dexie.js / IndexedDB for local persistence
- Supabase Auth
- Supabase PostgreSQL
- Supabase Storage for images
- ts-fsrs for spaced repetition
- Vitest and React Testing Library for unit/component tests
- Playwright for end-to-end tests
- Cloudflare Pages for static frontend hosting

Use stable, maintained library versions compatible with each other.

Avoid unnecessary dependencies and complex state-management frameworks.

No custom always-running server, VPS, Docker-based production infrastructure, or AWS infrastructure should be required.

Supabase is the managed authoritative backend. The client must be local-first and usable without an internet connection after initial setup and data download.

The UI language must be German. Code, documentation, and comments may be English.

## 2. Essential user experience

### Desktop creation workflow

The user should be able to:

1. Open the app in a browser.
2. Select an existing deck or create a new one.
3. Capture a screenshot using the operating system.
4. Paste the screenshot using Ctrl+V / Cmd+V.
5. Immediately see the image in an image occlusion editor.
6. Draw one or multiple rectangular occlusion regions using the mouse.
7. Save the image and its occlusions with one action.

No title, question text, answer text, or metadata should be required.

The currently selected deck must remain selected between card creations.

Support drag-and-drop and file upload as alternatives to clipboard paste.

Optimize keyboard shortcuts and minimize modal dialogs.

Creation must work offline.

### Image occlusion semantics

Each occlusion region creates exactly one independent flashcard.

Example:

One screenshot with five rectangular regions creates five flashcards, each with its own FSRS scheduling state.

Store the image only once.

Store occlusion regions as normalized coordinates relative to the original image dimensions, not as permanently edited pixels.

Use a normalized coordinate system with x, y, width, height values between 0 and 1.

Maintain stable region and card IDs.

During review:

- Display the full original image.
- Hide the target region.
- Hide other regions from the same image by default to avoid revealing answers.
- Visually distinguish the target region.
- When the user reveals the answer, uncover the target region.
- Allow configurable behavior for other masks later, but implement only the default mode initially.

Implement responsive image rendering and ensure occlusions stay aligned during resizing, zooming, and panning.

Support pinch-to-zoom on mobile and zoom/pan on desktop.

Allow users to edit, add, and remove occlusion regions after creation.

Editing a region should preserve its card's review history whenever the underlying learning target remains the same.

Deleting a region must not affect unrelated cards.

### Deck organization

Support nested decks of arbitrary reasonable depth.

Example:

Semester 3
  - Anatomy
    - Lecture 01
    - Lecture 02
  - Physiology
    - Cardiovascular System

Each image belongs to one deck.

Allow moving images and cards between decks.

Reviewing a parent deck must include cards from all descendant decks.

Avoid double-counting cards when aggregating deck statistics.

Support renaming, moving, and deleting decks with explicit confirmation for destructive actions.

Prevent cyclic deck hierarchies.

## 3. Spaced repetition

Use ts-fsrs rather than implementing a custom scheduling algorithm.

Provide the following review ratings:

- Nochmal / Again
- Schwer / Hard
- Gut / Good
- Einfach / Easy

Each card has independent FSRS scheduling state.

Persist all fields required to reconstruct the scheduler state correctly.

Persist review events as an append-only history.

Store timestamps in UTC.

Use the user's local timezone for determining daily review boundaries.

Provide:

- Due cards
- New cards
- Review counts
- Basic daily statistics
- A configurable daily new-card limit
- A configurable review-day boundary

Avoid complex gamification and unnecessary analytics.

The scheduling behavior must be deterministic and testable with a fixed clock.

Review actions must update the local database immediately, without waiting for the cloud.

## 4. Offline-first architecture

This is a mandatory feature, not an optional enhancement.

The app must remain usable after the laptop or smartphone loses connectivity.

Use IndexedDB as the local source of truth for the running UI.

Cache:

- Deck metadata
- Image metadata
- Occlusion regions
- Cards
- FSRS scheduling state
- Review history
- Required image blobs
- Pending synchronization operations

Do not rely exclusively on browser HTTP caching for image availability.

Store image blobs explicitly in IndexedDB or another well-supported persistent browser storage mechanism.

Provide an explicit "Download for offline use" action for decks and their descendants.

Display download progress and available offline status.

Never claim that a deck is fully available offline until all required images and metadata have been verified locally.

Account for browser storage eviction and quota limits.

Request persistent browser storage where supported, but do not assume the browser will grant it.

Detect missing offline assets and report them clearly.

The app shell must load offline after initial installation.

All already-cached cards must remain reviewable offline.

## 5. Synchronization architecture

Use Supabase as the cloud authority for synchronized user data.

Do not require both devices to be online simultaneously.

Implement a robust local-first synchronization engine.

Requirements:

- Durable local outbox for pending mutations
- Unique operation IDs
- Idempotent mutation processing
- Retry with exponential backoff
- Automatic synchronization on reconnect
- Synchronization on app startup and foreground activation
- Visible sync status
- Last successful sync timestamp
- No silent loss of review events
- Safe handling of partial upload failures
- Recovery after interrupted image uploads
- No duplicate cards from retried creation operations

A review event must never be applied twice.

Do not implement synchronization using naive last-write-wins overwrites of FSRS state.

The review event log is the authoritative history for scheduling.

For conflicting review events created offline on multiple devices:

1. Preserve both events.
2. Deduplicate by event ID.
3. Establish a documented deterministic ordering.
4. Recompute the affected card's FSRS state from the canonical event history.
5. Reconcile all clients to the resulting canonical state.

Do not blindly overwrite newer card state with stale offline state.

Document limitations around concurrent offline reviews and explain how conflicts are resolved.

Use server-side transactions or database functions where necessary to preserve integrity.

Ensure an operation that uploads an image and creates its metadata can recover safely from partial failure.

The application must be functional without Supabase connectivity once authenticated and cached.

## 6. Database design

Create versioned SQL migrations.

Design at least the following entities:

### profiles
- user_id
- created_at
- settings

### decks
- id
- user_id
- parent_id
- name
- created_at
- updated_at
- version
- deleted_at

### images
- id
- user_id
- deck_id
- storage_path
- width
- height
- mime_type
- content_hash
- created_at
- updated_at
- version
- deleted_at

### occlusion_regions
- id
- user_id
- image_id
- x
- y
- width
- height
- created_at
- updated_at
- version
- deleted_at

### cards
- id
- user_id
- region_id
- created_at
- updated_at
- version
- deleted_at

### card_scheduling
- card_id
- user_id
- FSRS state fields
- due_at
- last_review_at
- review_count
- scheduler_version
- updated_at

### review_events
- id
- user_id
- card_id
- rating
- reviewed_at
- canonical_order
- scheduler_version
- created_at

### sync_operations
- id
- user_id
- device_id
- operation_type
- operation_payload
- processing_status
- created_at
- processed_at

You may refine this schema if needed, but explain any changes.

Use UUIDs for stable entity IDs.

Include indexes, constraints, foreign keys, and appropriate cascade behavior.

Use soft deletion where necessary to support reliable synchronization.

Avoid permanent deletion of images still referenced by cards.

Provide an explicit strategy for garbage collection of unreferenced image objects.

## 7. Security

Implement Supabase Auth.

Use email-based authentication, preferably passwordless if practical.

Each user must only access their own data.

Enable and test Row Level Security on every relevant table.

Apply appropriate access restrictions to Supabase Storage.

Use private image storage buckets.

Use short-lived signed URLs or authenticated storage access where appropriate.

Never expose the Supabase service-role key in the frontend.

Only public client configuration and the publishable/anon key may be included in the frontend bundle.

Do not trust user IDs supplied by the client without verifying authentication.

Validate all writes on the server/database side.

Protect against unauthorized modification of other users' decks, cards, images, and review events.

Validate file types, file sizes, and image dimensions.

Use safe image processing and avoid unnecessary retention of original clipboard metadata.

Do not introduce third-party analytics or advertising trackers.

Ensure database functions execute with appropriately restricted privileges.

Write tests proving that one authenticated user cannot access another user's data or images.

## 8. Image handling and performance

Optimize screenshots before upload.

Prefer WebP when supported and appropriate.

Preserve legibility of small text, formulas, and diagrams.

Do not apply overly aggressive compression.

Deduplicate identical images within the same user account using a content hash.

Avoid duplicate uploads when multiple regions reference the same image.

Implement lazy loading, local image caching, and efficient rendering.

Avoid downloading an entire account's image library unnecessarily.

Support an offline download workflow for selected decks.

Target smooth review performance on ordinary smartphones.

## 9. Mobile PWA

Design mobile-first.

The app must work well in modern Android Chrome and iOS Safari.

Provide:

- Responsive layouts
- Large touch targets
- Full-screen review experience
- Installable PWA
- App icons and manifest
- Offline app shell
- Touch gestures for image zoom and pan
- Clear loading and synchronization indicators

Reviewing should require minimal interaction:

1. Open the app.
2. Tap "Lernen".
3. View a due card.
4. Tap to reveal.
5. Select a rating.
6. Automatically advance.

Do not require users to navigate through multiple menus before reviewing.

Avoid relying on browser background synchronization APIs as the sole sync mechanism because support differs across platforms.

## 10. UI design

Use a minimal, modern interface.

Prioritize speed, clarity, and readability over visual decoration.

Main screens:

1. Dashboard
2. Deck browser
3. Image occlusion editor
4. Review screen
5. Basic settings and synchronization status

The dashboard should show:

- Cards due today
- New cards available
- Recently used decks
- One prominent "Lernen" action
- One prominent "Karte erstellen" action

Use German UI labels.

Support light and dark mode.

Include accessible keyboard navigation and visible focus states.

Avoid building unnecessary features such as:

- Note editors
- Markdown documents
- AI card generation
- Social sharing
- Collaboration
- Public deck marketplaces
- Complex gamification
- Native mobile applications
- Electron wrappers

## 11. Data portability and backups

Implement full export and import.

Export should include:

- Deck hierarchy
- Images
- Occlusion regions
- Card metadata
- Scheduling state
- Review event history
- Relevant settings
- Schema and scheduler versions

Use a documented ZIP-based format containing JSON metadata and image files.

Validate imports before modifying existing data.

Avoid duplicate IDs and duplicate cards on repeated imports.

Preserve review history and due dates.

Provide clear errors for unsupported export versions.

Test complete export/import round trips.

Do not depend on the continued availability of Supabase for users to export locally cached data.

## 12. Development phases

Implement the project in the following order.

### Phase 1 — Local functional MVP

Build:

- React application
- IndexedDB schema
- Nested decks
- Clipboard screenshot paste
- Image occlusion editor
- One card per occlusion region
- Local FSRS scheduling
- Review interface
- Basic unit tests

Do not integrate Supabase yet.

The app must be usable locally at the end of this phase.

### Phase 2 — Cloud synchronization

Build:

- Supabase Auth
- SQL migrations
- RLS policies
- Private image storage
- Local outbox
- Idempotent synchronization
- Review event reconciliation
- Multi-device tests

### Phase 3 — Offline PWA

Build:

- Service worker
- PWA installation
- Offline deck downloads
- IndexedDB image cache
- Storage quota handling
- Mobile gestures
- Offline/online synchronization tests

### Phase 4 — Production hardening

Build:

- Export/import
- Security tests
- End-to-end tests
- Performance optimizations
- Cloudflare Pages deployment configuration
- Setup documentation
- Backup and recovery documentation

Each phase must leave the project in a runnable, tested state.

## 13. Acceptance tests

The project is not complete until the following scenarios work.

### Test A: Screenshot to flashcard

Given a selected deck and an image in the clipboard:

- Paste the image.
- Draw three occlusion rectangles.
- Save.
- Verify exactly three independent cards exist.
- Verify only one underlying image object exists.
- Verify the cards can be reviewed immediately.

### Test B: Multi-device synchronization

- Create cards on Device A.
- Complete synchronization.
- Turn Device A off.
- Open Device B.
- Synchronize.
- Verify all cards and images are available.
- Review cards on Device B.
- Synchronize.
- Reopen Device A.
- Verify the updated scheduling state appears.

### Test C: Offline review

- Download a deck for offline use.
- Disconnect the device.
- Restart the installed PWA.
- Review at least 20 cards.
- Verify all images remain available.
- Verify review events persist across app restarts.
- Reconnect.
- Verify events synchronize exactly once.

### Test D: Concurrent offline review

- Synchronize two devices.
- Disconnect both.
- Review the same card on both devices.
- Reconnect them in different orders.
- Verify both review events are preserved.
- Verify final scheduling state is deterministic.
- Verify neither device loses review history.

### Test E: Nested decks

- Create a parent deck with two child decks.
- Add cards to both child decks.
- Review the parent deck.
- Verify all descendant cards are included.
- Verify no duplicates.

### Test F: Image geometry

- Create occlusions on a desktop.
- Open the same card on a narrow smartphone.
- Zoom and pan.
- Verify the masks remain aligned with the original image.

### Test G: Security

- Create two test users.
- Verify User A cannot read or modify User B's data.
- Verify User A cannot retrieve User B's private images.
- Verify forged ownership fields are rejected.

### Test H: Export/import

- Export an account containing decks, images, cards, and review history.
- Import into an empty local database.
- Verify the deck hierarchy and image masks.
- Verify scheduling states and due dates.
- Verify review event counts.
- Repeat import and verify no duplicates.

### Test I: Sync failure recovery

- Interrupt an image upload.
- Retry synchronization.
- Verify no orphaned visible cards or duplicate image records.
- Interrupt a review-event upload after server acceptance but before client acknowledgment.
- Retry.
- Verify the review event is applied exactly once.

## 14. Development workflow and reporting

Before implementation:

1. Inspect the repository.
2. Produce a concise architecture document.
3. Explain the database schema.
4. Explain the synchronization and conflict-resolution algorithm.
5. Identify major technical risks.
6. Create a phased implementation checklist.

Then implement the phases sequentially.

Do not stop after writing a plan.

Run tests and fix failures after each phase.

Use automated tests whenever possible.

Do not claim tests passed unless they actually ran.

If external credentials, a Supabase project, or deployment permissions are needed, stop at the relevant boundary and provide exact setup instructions.

Do not invent credentials or claim a deployment succeeded without verification.

Maintain:

- README.md
- ARCHITECTURE.md
- IMPLEMENTATION_PLAN.md
- DATABASE.md
- SYNC_DESIGN.md
- TESTING.md

Record decisions and important tradeoffs.

At the end of each phase, report:

- Implemented features
- Files changed
- Tests executed and their results
- Remaining issues
- Required user actions
- Next phase

## 15. Product priorities

When tradeoffs arise, prioritize in this order:

1. Data integrity and no lost learning progress
2. Fast screenshot-to-flashcard creation
3. Reliable offline reviewing
4. Seamless multi-device synchronization
5. Correct spaced repetition
6. Mobile usability
7. Low or zero operating costs
8. Visual polish

Avoid overengineering features unrelated to these priorities.

The final result should feel like a lightweight, purpose-built replacement for RemNote's image occlusion workflow, not a general flashcard platform.

Begin by creating the architecture and implementation plan, then proceed with Phase 1.
