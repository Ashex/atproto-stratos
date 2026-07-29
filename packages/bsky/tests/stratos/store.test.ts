import { TestNetwork } from '@atproto/dev-env'
import { Database } from '../../src/data-plane/server/db'
import { indexStratosRecord } from '../../src/stratos/record-indexer'
import { StratosStore } from '../../src/stratos/store'

describe('stratos store', () => {
  let network: TestNetwork
  let db: Database
  let store: StratosStore

  const gokuDid = 'did:plc:goku'
  const vegetaDid = 'did:plc:vegeta'
  const piccoloDid = 'did:plc:piccolo'

  beforeAll(async () => {
    network = await TestNetwork.create({
      dbPostgresSchema: 'stratos_store',
    })
    db = network.bsky.db
    store = new StratosStore(db.db)

    // Seed test data
    const posts = [
      {
        uri: `at://${gokuDid}/zone.stratos.feed.post/post1`,
        cid: 'bafyrei1',
        record: {
          $type: 'zone.stratos.feed.post',
          text: 'Spirit Bomb technique',
          boundary: { values: [{ value: 'z-fighters' }] },
          createdAt: '2024-01-15T10:00:00.000Z',
        },
      },
      {
        uri: `at://${gokuDid}/zone.stratos.feed.post/post2`,
        cid: 'bafyrei2',
        record: {
          $type: 'zone.stratos.feed.post',
          text: 'Capsule Corp meeting notes',
          boundary: { values: [{ value: 'z-fighters' }, { value: 'capsule-corp' }] },
          createdAt: '2024-01-15T11:00:00.000Z',
        },
      },
      {
        uri: `at://${vegetaDid}/zone.stratos.feed.post/post3`,
        cid: 'bafyrei3',
        record: {
          $type: 'zone.stratos.feed.post',
          text: 'Training at 500x gravity',
          boundary: { values: [{ value: 'capsule-corp' }] },
          createdAt: '2024-01-15T12:00:00.000Z',
        },
      },
      {
        uri: `at://${piccoloDid}/zone.stratos.feed.post/post4`,
        cid: 'bafyrei4',
        record: {
          $type: 'zone.stratos.feed.post',
          text: 'Namekian meditation guide',
          boundary: { values: [{ value: 'namekians' }] },
          createdAt: '2024-01-15T13:00:00.000Z',
        },
      },
    ]

    const indexedAt = new Date().toISOString()
    for (const { uri, cid, record } of posts) {
      await indexStratosRecord(db.db, uri, cid, record, indexedAt)
    }

    // Seed enrollment data
    await db.db
      .insertInto('stratos_enrollment')
      .values([
        {
          did: gokuDid,
          serviceUrl: 'https://stratos.example.com',
          enrolledAt: '2024-01-01T00:00:00.000Z',
          lastChecked: new Date().toISOString(),
          boundaries: JSON.stringify(['z-fighters', 'capsule-corp']),
        },
        {
          did: vegetaDid,
          serviceUrl: 'https://stratos.example.com',
          enrolledAt: '2024-01-01T00:00:00.000Z',
          lastChecked: new Date().toISOString(),
          boundaries: JSON.stringify(['capsule-corp']),
        },
      ])
      .execute()
  })

  afterAll(async () => {
    await network.close()
  })

  describe('getPost', () => {
    it('returns a post with boundaries', async () => {
      const post = await store.getPost(
        `at://${gokuDid}/zone.stratos.feed.post/post1`,
      )
      expect(post).toBeTruthy()
      expect(post!.text).toBe('Spirit Bomb technique')
      expect(post!.boundaries).toEqual(['z-fighters'])
    })

    it('returns null for non-existent post', async () => {
      const post = await store.getPost(
        `at://${gokuDid}/zone.stratos.feed.post/fake`,
      )
      expect(post).toBeNull()
    })
  })

  describe('getTimeline', () => {
    it('returns posts matching viewer boundaries', async () => {
      const result = await store.getTimeline({
        viewerBoundaries: ['z-fighters'],
        limit: 10,
      })
      expect(result.posts.length).toBeGreaterThanOrEqual(1)
      // Each returned post should have at least one z-fighters boundary
      for (const post of result.posts) {
        const boundaries = await store.getPostBoundaries(post.uri)
        expect(boundaries).toContain('z-fighters')
      }
    })

    it('returns posts from multiple boundaries', async () => {
      const result = await store.getTimeline({
        viewerBoundaries: ['z-fighters', 'capsule-corp'],
        limit: 10,
      })
      // Should include posts from z-fighters and capsule-corp
      expect(result.posts.length).toBeGreaterThanOrEqual(3)
    })

    it('excludes posts from other boundaries', async () => {
      const result = await store.getTimeline({
        viewerBoundaries: ['capsule-corp'],
        limit: 10,
      })
      const uris = result.posts.map((p) => p.uri)
      expect(uris).not.toContain(
        `at://${piccoloDid}/zone.stratos.feed.post/post4`,
      )
    })

    it('respects limit param', async () => {
      const result = await store.getTimeline({
        viewerBoundaries: ['z-fighters', 'capsule-corp'],
        limit: 2,
      })
      expect(result.posts.length).toBeLessThanOrEqual(2)
      expect(result.cursor).toBeTruthy()
    })

    it('paginates with cursor', async () => {
      const page1 = await store.getTimeline({
        viewerBoundaries: ['z-fighters', 'capsule-corp'],
        limit: 2,
      })
      const page2 = await store.getTimeline({
        viewerBoundaries: ['z-fighters', 'capsule-corp'],
        limit: 10,
        cursor: page1.cursor,
      })
      const uris1 = page1.posts.map((p) => p.uri)
      const uris2 = page2.posts.map((p) => p.uri)
      // No overlap between pages
      for (const uri of uris2) {
        expect(uris1).not.toContain(uri)
      }
    })

    it('returns empty for no matching boundaries', async () => {
      const result = await store.getTimeline({
        viewerBoundaries: ['nonexistent'],
        limit: 10,
      })
      expect(result.posts).toHaveLength(0)
    })
  })

  describe('getAuthorFeed', () => {
    it('returns posts by author visible to viewer', async () => {
      const result = await store.getAuthorFeed({
        actorDid: gokuDid,
        viewerBoundaries: ['z-fighters'],
        limit: 10,
      })
      expect(result.posts.length).toBeGreaterThanOrEqual(1)
      for (const post of result.posts) {
        expect(post.creator).toBe(gokuDid)
      }
    })

    it('filters by specific boundary', async () => {
      const result = await store.getAuthorFeed({
        actorDid: gokuDid,
        viewerBoundaries: ['z-fighters', 'capsule-corp'],
        boundary: 'capsule-corp',
        limit: 10,
      })
      for (const post of result.posts) {
        const boundaries = await store.getPostBoundaries(post.uri)
        expect(boundaries).toContain('capsule-corp')
      }
    })

    it('returns empty when viewer has no matching boundary', async () => {
      const result = await store.getAuthorFeed({
        actorDid: vegetaDid,
        viewerBoundaries: ['z-fighters'],
        limit: 10,
      })
      // Vegeta's post is in capsule-corp only, viewer only has z-fighters
      expect(result.posts).toHaveLength(0)
    })
  })

  describe('enrollment operations', () => {
    it('checks enrollment status', async () => {
      expect(await store.isEnrolled(gokuDid)).toBe(true)
      expect(await store.isEnrolled(piccoloDid)).toBe(false)
    })

    it('gets enrollment record', async () => {
      const enrollment = await store.getEnrollment(gokuDid)
      expect(enrollment).toBeTruthy()
      expect(enrollment!.did).toBe(gokuDid)
      expect(enrollment!.serviceUrl).toBe('https://stratos.example.com')
    })

    it('gets boundaries for enrolled user', async () => {
      const boundaries = await store.getBoundaries(gokuDid)
      expect(boundaries).toContain('z-fighters')
      expect(boundaries).toContain('capsule-corp')
    })

    it('returns empty boundaries for unknown user', async () => {
      const boundaries = await store.getBoundaries(piccoloDid)
      expect(boundaries).toHaveLength(0)
    })

    it('upserts enrollment', async () => {
      await store.upsertEnrollment({
        did: piccoloDid,
        serviceUrl: 'https://stratos.example.com',
        enrolledAt: '2024-01-01T00:00:00.000Z',
        boundaries: ['namekians'],
      })
      expect(await store.isEnrolled(piccoloDid)).toBe(true)
      const boundaries = await store.getBoundaries(piccoloDid)
      expect(boundaries).toEqual(['namekians'])
    })
  })

  describe('sync cursor', () => {
    it('returns null for unknown actor', async () => {
      const cursor = await store.getSyncCursor('did:plc:unknown')
      expect(cursor).toBeNull()
    })

    it('updates and retrieves sync cursor', async () => {
      await store.updateSyncCursor(gokuDid, 42)
      const cursor = await store.getSyncCursor(gokuDid)
      expect(cursor).toBe(42)
    })

    it('updates existing cursor', async () => {
      await store.updateSyncCursor(gokuDid, 100)
      const cursor = await store.getSyncCursor(gokuDid)
      expect(cursor).toBe(100)
    })
  })
})
