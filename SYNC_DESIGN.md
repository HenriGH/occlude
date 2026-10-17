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
