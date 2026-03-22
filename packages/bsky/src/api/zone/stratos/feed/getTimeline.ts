import { InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from '../../../../context'
import { Server } from '../../../../lexicon'
import { StratosPostRow } from '../../../../stratos/store'

function buildBoundaryField(boundaries: string[] | undefined) {
  if (!boundaries || boundaries.length === 0) return undefined
  return { values: boundaries.map((b) => ({ value: b })) }
}

function buildPostRecord(post: StratosPostRow, boundaries?: string[]) {
  return {
    $type: 'zone.stratos.feed.post',
    text: post.text,
    createdAt: post.createdAt,
    ...(post.facets ? { facets: JSON.parse(post.facets) } : {}),
    ...(post.embed ? { embed: JSON.parse(post.embed) } : {}),
    ...(post.langs ? { langs: post.langs.split(',') } : {}),
    ...(post.tags ? { tags: post.tags.split(',') } : {}),
    ...(boundaries?.length
      ? { boundary: buildBoundaryField(boundaries) }
      : {}),
    ...(post.replyParent && post.replyRoot
      ? {
          reply: {
            parent: {
              uri: post.replyParent,
              cid: post.replyParentCid ?? '',
            },
            root: {
              uri: post.replyRoot,
              cid: post.replyRootCid ?? '',
            },
          },
        }
      : {}),
  }
}

export default function (server: Server, ctx: AppContext) {
  server.zone.stratos.feed.getTimeline({
    auth: ctx.authVerifier.standard,
    handler: async ({ params, auth }) => {
      const viewer = auth.credentials.iss
      const stratosStore = ctx.stratosStore
      if (!stratosStore) {
        throw new InvalidRequestError('Stratos integration not configured')
      }

      const viewerBoundaries =
        await ctx.stratosEnrollmentManager!.getBoundaries(viewer)
      if (viewerBoundaries.length === 0) {
        return {
          encoding: 'application/json' as const,
          body: { feed: [] },
        }
      }

      const boundaries = params.boundary
        ? viewerBoundaries.filter((b) => b === params.boundary)
        : viewerBoundaries

      const result = await stratosStore.getTimeline({
        viewerBoundaries: boundaries,
        limit: params.limit,
        cursor: params.cursor,
      })

      const uris = result.posts.map((p) => p.uri)
      const dids = [...new Set(result.posts.map((p) => p.creator))]
      const [boundaryMap, handleMap] = await Promise.all([
        stratosStore.getBoundariesForPosts(uris),
        resolveHandles(ctx, dids),
      ])

      const feed = result.posts.map((post) => ({
        post: {
          uri: post.uri,
          cid: post.cid,
          author: {
            did: post.creator,
            handle: handleMap.get(post.creator) ?? post.creator,
          },
          record: buildPostRecord(
            post,
            boundaryMap.get(post.uri)?.filter((b) => viewerBoundaries.includes(b)),
          ),
          indexedAt: post.indexedAt,
        },
      }))

      return {
        encoding: 'application/json' as const,
        body: { feed, cursor: result.cursor },
      }
    },
  })
}

async function resolveHandles(
  ctx: AppContext,
  dids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (dids.length === 0) return map

  try {
    const actors = await ctx.hydrator.actor.getActors(dids, {})
    for (const [did, actor] of actors) {
      if (actor?.handle) {
        map.set(did, actor.handle)
      }
    }
  } catch {
    // Best-effort: fall back to DID
  }
  return map
}
