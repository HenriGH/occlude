# Synchronization design (Phase 2 contract, not yet integrated)

1. Commit local changes and a UUID-keyed outbox operation in one transaction.
2. Upload missing image content to the user's hash-derived private Storage path.
   Retry the same path; verify content before publishing related metadata.
3. Send mutation batches to an authenticated transactional SQL RPC. Derive owner
   from auth.uid(), validate entity ownership and payload constraints. Record the
   operation ID in sync_operations atomically with its mutation. An acknowledged
   duplicate returns the prior result. Mark local acknowledgment only afterward.
4. Pull changed entities/tombstones using a server cursor with a deterministic
   tie-breaker; apply a page and its cursor atomically. Never advance on failure.
5. Retry durable operations with capped exponential backoff plus jitter on startup,
   reconnect, and foreground activation. Show pending/error/last-success states.

## Review conflicts

Events are append-only; a repeated event ID is not a second review. Preserve both
events from concurrent devices. Canonical order is `(reviewed_at UTC, event UUID)`.
Replay using the pinned, fuzz-disabled scheduler from an empty card at its original
creation time. Equal timestamps are safe; ordering is deterministic. Never merge
schedule snapshots by last-write-wins. Materialized scheduling must be updated from
the same canonical event history, with a revision/hash to detect stale projections.
The client and a trusted reconciliation function must share the pinned scheduler.
Client timestamps are retained; clock skew can affect order and resulting intervals.

## Failure recovery

An uploaded object without metadata is invisible and can be retried/collected later.
Metadata operations are atomic across image/regions/cards. A response lost after
commit leaves an outbox entry whose next retry returns the prior acknowledgment.
Never remove an unacknowledged review event. Tombstones prevent stale clients from
resurrecting deleted cards. Editing a mask preserves its region/card identifiers;
new masks start new histories. Changing the underlying target requires a new mask.

## Required proof before release

Test independent browser contexts, opposite reconnect orders, interrupted uploads,
lost acknowledgments, quota errors, two-user RLS/storage isolation, and recovery
after app restart. Local deterministic replay tests alone do not verify cloud sync.
