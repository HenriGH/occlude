# Synchronization design

## Current boundary

Phase 2 client/RPC code is implemented. PostgreSQL behavior is tested locally with
PGlite, including two independent Dexie databases. The user reports successful
sign-in and synchronization across live devices. Automated checks still use local
SQL and intercepted HTTP; they do not independently verify hosted services.

## Local commit and durable delivery

A connected workspace atomically commits every local mutation together with a UUID
operation in Dexie's `outbox`. `syncMeta` persists the owner, device UUID, monotonically
increasing queue order, optimistic entity versions, and last successful sync. Local
editing, saving and review do not wait for the network. Failure to write the outbox rolls back the
mutation. An unconnected workspace remains usable and has no upload queue yet.

Binding the first account explicitly adopts existing local data and queues it in
parent-first order. An untouched default deck on a second device is replaced by
cloud metadata instead of creating a duplicate default deck. Browser storage stays
bound to that account; switching to another user is blocked. Explicit sign-out
locks the cached UI and retains pending work. An expired/failed cloud session does
not lock the cache: the original workspace remains locally usable and queues work
until reauthentication. A different signed-in account still blocks access. Cached
data is not encrypted.

The engine runs on connection, startup, foreground activation, reconnect, pending
mutations, and a 15-second foreground timer. Hidden tabs do not poll. Initial,
focus and visibility triggers are coalesced after 400 ms; new local writes trigger
a 300 ms debounce using the durable enqueue sequence, not outbox deletions.
An active worker remembers new requests and drains another pass; queues exceeding
100 operations continue in batches without waiting for the next timer. Web Locks,
where supported, serialize automatic workers across tabs sharing the same database.

Only local library data and the small cached account binding guard initial render.
Neither Auth recovery, a network request nor loading outbox payloads holds the
startup screen. Status queries use primary-key cursors rather than cloning the
queued image/region payloads. Library statistics are memoized across cloud-status
updates. Transactions never hold IndexedDB open across a network request.

Existing workspaces initialize with a read, avoiding a startup write lock shared
with browser tabs and the installed app. First-launch seeding still checks again
inside a transaction so concurrent instances cannot create duplicate defaults.
IndexedDB's `blocked` upgrade event immediately shows instructions to save work
and close the other Occlude browser tab. Other unresolved local startup reads get
the same recovery guidance after six seconds, phrased conditionally because a
slow read does not prove another tab is responsible. Pending requests continue
and the app renders automatically when the blocker releases. Reload never clears
local data, the owner binding or queued operations; no storage or Web Lock is stolen.

Optional mask questions travel as `regions[].label` inside the existing atomic
`image.put` command. A label-only edit keeps card identity and review history;
unchanged labels remain local no-ops and the original image is not uploaded again.
The additive `202610170002_mask_labels.sql` migration adds the bounded text column
and advertises `region-labels` in the snapshot's `features`, keeping schemaVersion
1 compatible with old clients. An omitted label preserves server text; an explicit
empty string clears it. This lets older installed clients edit geometry without
silently erasing questions on the server.

Snapshots cache feature support locally. A labelled command checks support before
upload/apply if it has not already been confirmed; subsequent commands need no
extra feature query. An old backend produces a migration instruction and retains
the pending operation. Retry checks again after the migration becomes available.

Transient failures use durable capped
exponential backoff with jitter (about 1 second to 5 minutes); manual retry resets
the delay. A connection failure stops the current batch instead of repeating the
same failing request for every queued card. JSON/Auth requests have a 20-second
timeout; Storage requests allow 90 seconds for slow image transfers. Deadlines
include response-body consumption, not just the arrival of HTTP headers.
Each access token is verified once with Auth, sharing concurrent verification;
failed verifications are not cached. Every HTTP operation still obtains the current
session, checks the verified workspace owner, and pins that token for its request.
Refreshes and account switches change the token and require verification again.
RLS continues to authorize every server request. UUID idempotency protects retries.

## Image publication

Content-addressed bytes upload first to the immutable private path `<user>/<hash>`.
The RPC refuses image metadata until the Storage object exists. One transaction
creates/updates image placement, regions, and cards. Retries reuse IDs. A lost
upload acknowledgment triggers an authenticated download and SHA-256 verification,
not an overwrite. Successful uploads, verified downloads and published snapshot
images persist an owner/hash marker, so later mask edits and moves do not upload
the same original again, including after a reload. Failed uploads never set it.
Unchanged editor saves do not queue work; edits do not rewrite a cached original
Blob. Blob data stays local while pending operations may still need it.
Cloud bytes are verified before caching. Metadata pulls do not download all images;
visible thumbnails, editing, and review fetch required assets lazily. Concurrent
requests for the same missing image share a single download; cached opens use no
HTTP request.

## Metadata conflicts and deletion

`deck.put/delete`, `image.put/delete`, and `settings.put` carry a base version.
The SQL RPC obtains a per-user transaction lock, validates ownership and graph
constraints, and rejects a mismatched version instead of overwriting newer state.
The operation log and mutation commit together. A repeated operation ID returns
the original acknowledgment; a reused ID with different contents is rejected.

Conflicts remain durable and visible. Settings offers explicit rebasing of the
local version, or adopting cloud metadata after confirmation. Adopting cloud data
never discards review operations and is blocked if they need a card not yet on the
server. Tombstones cannot be resurrected by stale writes. Concurrent structural
conflicts, such as identical content created independently in the same deck, may
need deliberate reconciliation; pending changes and learning events remain retained.

Deck deletion tombstones actual server descendants in one transaction. Image and
mask deletion tombstone cards but retain review events. Even a review arriving
after its card was deleted is accepted into history without restoring the card.

## Canonical scheduling

Static vector diagrams belong to basic-card metadata (`front_svg`/`back_svg` on
the wire and `frontSvg`/`backSvg` locally). New writes validate bounded passive
SVGs, preserve the schedule, and share the existing transactional outbox.
Older writers omitting the fields preserve stored graphics; explicit empty strings
clear them. Retry acknowledgments never reapply an earlier graphic over a later edit.
Clients request snapshot v3 with known graphic-card versions. Matching live cards
omit SVG bodies and mark `svg_unchanged`; parsing requires a matching local version
before reusing captured graphics. Pending local card edits are excluded from this
optimization, and another account's cache is never advertised. First pulls and
changed cards include graphics; tombstones omit them. The remaining metadata and
event history still use full snapshots. Missing v3/v2 RPCs fall back in order;
authentication/server errors do not trigger fallback. Graphics remain local and
queued against a backend without `card-svg` support.

Question-answer cards use the same card IDs, append-only review events and FSRS
replay as image cards. Dexie v3 adds a deck index without changing old IDs/history.
`basic.put/delete` commits locally with an outbox operation; it never sends a
mutable schedule. Edits preserve learning history. Folder deletion tombstones
both types and retains reviews. Newly due cards join the current round locally.

Mixed-card clients request `occlude_snapshot_v2`, advertising `basic-cards`.
Only a missing-RPC error falls back to the original snapshot. The old snapshot
filters out basic cards and their reviews, preserving compatibility with old
clients. Against an old backend, local basic cards and queued edits are retained
until the migration is applied; they are not reconciled away.

ChatGPT writes through authenticated MCP tools and dedicated atomic SQL functions,
using a verified user JWT, never an elevated key. Supabase OAuth scopes establish
identity, so restrictive RLS additionally denies OAuth clients normal library,
Storage and sync-RPC access. A separate per-user/client capability, approved on
the consent page, allows only folder listing and new folder/card creation.
Revoking that capability blocks even an unexpired access token immediately.
An additional `can_manage` capability, false for existing grants until new consent,
allows question/label lookup and targeted deletions. Answers, image bytes and
review history stay private. Card deletions require exact IDs/versions; image-card
deletion also tombstones the mask and bumps the image version to reject stale
offline editors. Whole-folder deletion compares a fresh subtree snapshot digest,
including descendant metadata, then tombstones all contents atomically. Concurrent
changes invalidate the preview. Reviews remain append-only, including offline
reviews arriving after deletion. Physical asset/history purging remains separate.
MCP batch UUIDs and payloads are logged atomically for safe retries. New cards
appear through the existing background pull without an import or per-card
approval in Occlude. Deployment/public listing remain separate operator steps;
see [ChatGPT setup](docs/chatgpt/SETUP.md).

Review events are append-only, deduplicated by ID, and sorted by `(reviewed_at UTC,
event UUID)`. Equal timestamps use the UUID tie-breaker. Both concurrent answers
survive. Every client replays the same canonical events from the original card
creation time using `ts-fsrs@5.4.2/default/fuzz-off`. Local scheduling fields are
materialized in IndexedDB, including Dates, stability, difficulty, learning steps,
repetitions and lapses. Unknown scheduler versions stop reconciliation.

The server's `card_scheduling` is an RLS-protected **view of replay inputs**, not a
mutable schedule snapshot. No client-provided due date or FSRS state is accepted by
the RPC, eliminating last-write-wins schedule corruption without a second scheduler
implementation in PostgreSQL. Array position supplies canonical order; it is not
stored as a permanently assigned insertion sequence. Clock skew can change order
and intervals; this limitation is inherent to preserving offline client timestamps.

## Pull and recovery

One RPC returns a consistent full metadata/event snapshot, including tombstones.
The personal-library scope favors this simpler protocol over paginated cursors;
large histories will need incremental snapshots later. Image bytes remain lazy.
The client validates schema, ownership, references, coordinates, versions and event
IDs before applying data. Metadata is reconciled transactionally only when metadata
operations have drained; otherwise local metadata remains untouched. Reconciliation
puts/deletes only changed rows instead of clearing entire stores. Reviews merge by
ID; only cards with changed metadata or newly received events replay their history.
An unchanged snapshot writes no library rows and does not invalidate their live
queries. Local schedules and Date values remain intact. A crash cannot advance an
uncommitted pull checkpoint. The wire protocol still returns a full snapshot; these
changes require no new SQL migration.

Successful sync means the queue drained and canonical metadata/history was applied.
It does not mean every image is cached offline. The UI never labels a deck fully
offline-ready; verified deck downloads and app-shell restart belong to Phase 3.
