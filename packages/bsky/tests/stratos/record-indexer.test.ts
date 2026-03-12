import { TestNetwork } from '@atproto/dev-env'
import { Database } from '../../src/data-plane/server/db'
import {
  deleteStratosRecord,
  indexStratosRecord,
} from '../../src/stratos/record-indexer'
import { StratosStore } from '../../src/stratos/store'

describe('stratos record-indexer', () => {
  let network: TestNetwork
  let db: Database
  let store: StratosStore

  const gokuDid = 'did:plc:goku'
  const vegetaDid = 'did:plc:vegeta'

  beforeAll(async () => {
    network = await TestNetwork.create({
      dbPostgresSchema: 'stratos_record_indexer',
    })
    db = network.bsky.db
    store = new StratosStore(db.db)
  })

  afterAll(async () => {
    await network.close()
  })

  it('indexes a stratos post with boundaries', async () => {
    const uri = `at://${gokuDid}/zone.stratos.feed.post/abc123`
    const cid = 'bafyreigoku1'
    const record = {
      $type: 'zone.stratos.feed.post',
      text: 'Training in the Hyperbolic Time Chamber',
      boundary: { values: [{ value: 'z-fighters' }] },
      createdAt: '2024-01-15T10:00:00.000Z',
    }

    await indexStratosRecord(db.db, uri, cid, record, new Date().toISOString())

    const post = await store.getPost(uri)
    expect(post).toBeTruthy()
    expect(post!.uri).toBe(uri)
    expect(post!.cid).toBe(cid)
    expect(post!.creator).toBe(gokuDid)
    expect(post!.text).toBe('Training in the Hyperbolic Time Chamber')
    expect(post!.boundaries).toEqual(['z-fighters'])
  })

  it('indexes a post with multiple boundaries', async () => {
    const uri = `at://${gokuDid}/zone.stratos.feed.post/def456`
    const cid = 'bafyreigoku2'
    const record = {
      $type: 'zone.stratos.feed.post',
      text: 'Tournament of Power strategy',
      boundary: { values: [{ value: 'z-fighters' }, { value: 'universe-7' }] },
      createdAt: '2024-01-15T11:00:00.000Z',
    }

    await indexStratosRecord(db.db, uri, cid, record, new Date().toISOString())

    const post = await store.getPost(uri)
    expect(post).toBeTruthy()
    expect(post!.boundaries).toContain('z-fighters')
    expect(post!.boundaries).toContain('universe-7')
    expect(post!.boundaries).toHaveLength(2)
  })

  it('indexes a post with reply references', async () => {
    const parentUri = `at://${gokuDid}/zone.stratos.feed.post/abc123`
    const uri = `at://${vegetaDid}/zone.stratos.feed.post/reply789`
    const cid = 'bafyreivegeta1'
    const record = {
      $type: 'zone.stratos.feed.post',
      text: 'Kakarot, you fool!',
      boundary: { values: [{ value: 'z-fighters' }] },
      reply: {
        root: { uri: parentUri, cid: 'bafyreigoku1' },
        parent: { uri: parentUri, cid: 'bafyreigoku1' },
      },
      createdAt: '2024-01-15T12:00:00.000Z',
    }

    await indexStratosRecord(db.db, uri, cid, record, new Date().toISOString())

    const post = await store.getPost(uri)
    expect(post).toBeTruthy()
    expect(post!.replyRoot).toBe(parentUri)
    expect(post!.replyParent).toBe(parentUri)
  })

  it('deletes a stratos post', async () => {
    const uri = `at://${gokuDid}/zone.stratos.feed.post/abc123`

    await deleteStratosRecord(db.db, uri)

    const post = await store.getPost(uri)
    expect(post).toBeNull()
  })

  it('handles deleting a non-existent post gracefully', async () => {
    const uri = `at://${gokuDid}/zone.stratos.feed.post/nonexistent`

    // Should not throw
    await deleteStratosRecord(db.db, uri)
  })
})
