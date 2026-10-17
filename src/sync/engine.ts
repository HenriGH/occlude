import type { OccludeDB } from '../db'
import type { Asset } from '../domain'
import { enqueue, enqueueImage, versionKey, type Connection, type SyncStatus, type WireOperation } from './model'
import { mergeSnapshot, parseSnapshot } from './snapshot'
import { CloudError, type Transport } from './transport'

export function retryDelay(attempt: number, random = Math.random) { return Math.min(300000, 1000 * 2 ** Math.min(attempt, 9)) * (.8 + random() * .4) }
export class SyncEngine {
  private running = false
  private resolving = false
  private active?: Promise<void>
  private requested = false
  private downloads = new Map<string, Promise<Asset>>()
  constructor(private database: OccludeDB, private transport: Transport, private clock = Date.now, private random = Math.random) {}

  async connect(email: string) {
    const owner = await this.transport.userId()
    const snapshot = parseSnapshot(await this.transport.snapshot(owner), owner)
    await this.database.transaction('rw', this.database.tables, async () => {
      const prior = (await this.database.syncMeta.get('connection'))?.value as Connection | undefined
      if (prior && prior.userId !== owner) throw new Error('Dieses Gerät ist mit einem anderen Konto verbunden. Bitte mit dem ursprünglichen Konto anmelden.')
      await this.database.syncMeta.put({ key: 'connection', value: { userId: owner, email, locked: false } satisfies Connection })
      if (!prior) {
        const decks = await this.database.decks.toArray()
        const emptySeed = decks.length === 1 && decks[0].name === 'Mein Studium' && await this.database.images.count() === 0 && await this.database.reviews.count() === 0
        if (emptySeed && snapshot.decks.some(d => !d.deleted)) await this.database.decks.clear()
        else {
          // Parent-first ordering; each command is persisted before any network write.
          const remaining = new Map(decks.map(d => [d.id, d]))
          while (remaining.size) {
            let progress = false
            for (const [id, deck] of remaining) if (!deck.parentId || !remaining.has(deck.parentId)) {
              await enqueue(this.database, 'deck.put', id, deck as unknown as Record<string, unknown>); remaining.delete(id); progress = true
            }
            if (!progress) throw new Error('Die lokale Ordnerstruktur enthält einen Kreis.')
          }
          for (const image of await this.database.images.toArray()) await enqueueImage(this.database, image.id)
          for (const event of await this.database.reviews.toArray()) await enqueue(this.database, 'review.add', event.id, event as unknown as Record<string, unknown>)
          if (!snapshot.profile) {
            const prefs = (await this.database.preferences.get('app'))!
            await enqueue(this.database, 'settings.put', 'settings', { newLimit: prefs.newLimit, dayBoundary: prefs.dayBoundary })
          }
        }
      }
      await mergeSnapshot(this.database, snapshot)
    })
    await this.sync()
  }

  sync(): Promise<void> {
    if (this.resolving) return Promise.resolve()
    this.requested = true
    if (!this.active) {
      this.running = true
      this.active = (async () => {
        try {
          do {
            this.requested = false
            if (typeof navigator !== 'undefined' && navigator.locks) {
              // Tabs share IndexedDB. Serialize their workers so a delayed pull
              // from one tab cannot replace a newer acknowledged local state.
              await navigator.locks.request(`occlude-sync:${this.database.name}`, { ifAvailable: true }, async lock => { if (lock) await this.syncOnce() })
            } else await this.syncOnce()
          } while (this.requested)
        } finally { this.running = false; this.active = undefined }
      })()
    }
    return this.active
  }

  private async syncOnce() {
    try {
      const connection = (await this.database.syncMeta.get('connection'))?.value as Connection | undefined
      if (!connection || connection.locked) return
      await this.database.syncMeta.put({ key: 'status', value: { ...((await this.database.syncMeta.get('status'))?.value as SyncStatus), running: true, error: undefined } })
      if (await this.transport.userId() !== connection.userId) throw new Error('Kontowechsel erkannt. Synchronisierung wurde zum Schutz deiner Daten angehalten.')
      const pending = await this.database.outbox.orderBy('createdAt').toArray()
      const blocked = new Set<string>()
      let errorMessage = ''
      let processed = 0
      for (const operation of pending) {
        const group = versionKey(operation.kind, operation.entityId)
        if (blocked.has(group) || operation.state === 'conflict' || operation.nextAttemptAt > this.clock()) { blocked.add(group); continue }
        if (processed++ === 100) { this.requested = true; break }
        try {
          if (operation.kind === 'image.put') {
            const hash = String(operation.payload.assetHash)
            const key = `uploaded:${connection.userId}:${hash}`
            if (!(await this.database.syncMeta.get(key))?.value) {
              const asset = await this.database.assets.get(hash)
              if (!asset) throw new Error('Das Originalbild fehlt auf diesem Gerät. Die Änderung bleibt ausstehend.')
              await this.transport.upload(connection.userId, asset)
              await this.database.syncMeta.put({ key, value: true })
            }
          }
          const { id, deviceId, kind, entityId, baseVersion, payload } = operation
          const wire: WireOperation = { id, deviceId, kind, entityId, baseVersion, payload }
          await this.transport.apply(wire, connection.userId)
          // A crash before this deletion is safe: the same ID is retried unchanged.
          await this.database.outbox.delete(operation.id)
        } catch (e) {
          const error = e instanceof Error ? e.message : 'Synchronisierung fehlgeschlagen.'
          const conflict = e instanceof CloudError && e.conflict
          await this.database.outbox.update(operation.id, { attempts: operation.attempts + 1, nextAttemptAt: this.clock() + retryDelay(operation.attempts, this.random), state: conflict ? 'conflict' : 'pending', error })
          blocked.add(group); errorMessage = error
          // A network/auth failure affects the whole connection. Do not repeat
          // the same failing HTTP request for every queued card, then pull too.
          if (!conflict) { this.requested = false; throw e }
        }
      }
      const snapshot = parseSnapshot(await this.transport.snapshot(connection.userId), connection.userId)
      await this.database.transaction('rw', this.database.tables.filter(t => t.name !== 'assets'), async () => {
        await mergeSnapshot(this.database, snapshot)
        const remaining = await this.database.outbox.toArray()
        const previous = (await this.database.syncMeta.get('status'))?.value as SyncStatus | undefined
        await this.database.syncMeta.put({ key: 'status', value: { running: false, lastSuccess: remaining.length ? previous?.lastSuccess : this.clock(), error: errorMessage || remaining.find(o => o.error)?.error } satisfies SyncStatus })
      })
    } catch (e) {
      const prior = (await this.database.syncMeta.get('status'))?.value as SyncStatus | undefined
      await this.database.syncMeta.put({ key: 'status', value: { ...prior, running: false, error: e instanceof Error ? e.message : 'Synchronisierung fehlgeschlagen.' } satisfies SyncStatus })
    }
  }

  async retry() {
    await this.database.outbox.where('state').equals('pending').modify({ nextAttemptAt: 0 })
    await this.sync()
  }

  async rebase(operationId: string) {
    if (this.running || this.resolving) throw new Error('Bitte warten, bis die laufende Synchronisierung abgeschlossen ist.')
    this.resolving = true
    try {
      const connection = (await this.database.syncMeta.get('connection'))?.value as Connection | undefined
      if (!connection || connection.locked || await this.transport.userId() !== connection.userId) throw new Error('Bitte zuerst anmelden.')
      const snapshot = parseSnapshot(await this.transport.snapshot(connection.userId), connection.userId)
      await this.database.transaction('rw', this.database.tables, async () => {
        const op = await this.database.outbox.get(operationId)
        if (!op || op.state !== 'conflict' || op.kind === 'review.add') return
        const row = op.kind.startsWith('deck.') ? snapshot.decks.find(d => d.data.id === op.entityId) : op.kind.startsWith('image.') ? snapshot.images.find(i => i.data.id === op.entityId) : snapshot.profile ? { version: snapshot.profile.version, deleted: false } : undefined
        if (row?.deleted) throw new Error('Die Cloud-Version wurde gelöscht. Die lokale Änderung bleibt sicher gespeichert; gelöschte Karten werden nicht automatisch wiederhergestellt.')
        let version = row?.version ?? 0
        const related = (await this.database.outbox.orderBy('createdAt').toArray()).filter(o => versionKey(o.kind, o.entityId) === versionKey(op.kind, op.entityId))
        for (const queued of related) {
          await this.database.outbox.delete(queued.id)
          await this.database.outbox.add({ ...queued, id: crypto.randomUUID(), baseVersion: version++, state: 'pending', attempts: 0, nextAttemptAt: 0, error: undefined })
        }
        await this.database.syncMeta.put({ key: versionKey(op.kind, op.entityId), value: version })
      })
    } finally { this.resolving = false }
    await this.sync()
  }

  async acceptCloudMetadata() {
    if (this.running || this.resolving) throw new Error('Bitte warten, bis die laufende Synchronisierung abgeschlossen ist.')
    this.resolving = true
    try {
      const connection = (await this.database.syncMeta.get('connection'))?.value as Connection | undefined
      if (!connection || connection.locked || await this.transport.userId() !== connection.userId) throw new Error('Bitte zuerst anmelden.')
      const snapshot = parseSnapshot(await this.transport.snapshot(connection.userId), connection.userId)
      await this.database.transaction('rw', this.database.tables, async () => {
        const pending = await this.database.outbox.toArray()
        const knownCards = new Set(snapshot.cards.map(c => c.data.id))
        if (pending.some(o => o.kind === 'review.add' && !knownCards.has(String(o.payload.cardId)))) throw new Error('Es gibt Lernereignisse für Karten, die nur lokal existieren. Die lokale Version bleibt erhalten, damit kein Lernfortschritt verloren geht. Bitte zuerst diese Karten hochladen oder den Konflikt ihrer Bilder lösen.')
        await this.database.outbox.bulkDelete(pending.filter(o => o.kind !== 'review.add').map(o => o.id))
        for (const meta of await this.database.syncMeta.toArray()) if (meta.key.startsWith('version:')) await this.database.syncMeta.delete(meta.key)
        await mergeSnapshot(this.database, snapshot)
      })
    } finally { this.resolving = false }
    await this.sync()
  }

  async asset(imageId: string): Promise<Asset> {
    const image = await this.database.images.get(imageId)
    if (!image) throw new Error('Dieses Bild existiert nicht mehr.')
    const existing = await this.database.assets.get(image.assetHash)
    if (existing) return existing
    const pending = this.downloads.get(image.assetHash)
    if (pending) return pending
    const request = this.downloadAsset(image)
    this.downloads.set(image.assetHash, request)
    try { return await request }
    finally { this.downloads.delete(image.assetHash) }
  }

  private async downloadAsset(image: import('../domain').ImageRecord): Promise<Asset> {
    const connection = (await this.database.syncMeta.get('connection'))?.value as Connection | undefined
    if (!connection || connection.locked || await this.transport.userId() !== connection.userId) throw new Error('Bild nicht lokal vorhanden. Bitte mit dem verbundenen Konto online anmelden.')
    if (!image.width || !image.height || !image.mimeType) throw new Error('Bildmetadaten fehlen.')
    const blob = await this.transport.download(connection.userId, image.assetHash)
    const asset = { hash: image.assetHash, blob, width: image.width, height: image.height, mimeType: image.mimeType }
    await this.database.transaction('rw', this.database.assets, this.database.syncMeta, async () => {
      await this.database.assets.put(asset)
      await this.database.syncMeta.put({ key: `uploaded:${connection.userId}:${image.assetHash}`, value: true })
    })
    return asset
  }
}
