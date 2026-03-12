import { InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from '../../../../context'
import { Server } from '../../../../lexicon'

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

      const feed = result.posts.map((post) => ({
        post: {
          uri: post.uri,
          cid: post.cid,
          author: { did: post.creator, handle: post.creator },
          record: {
            $type: 'zone.stratos.feed.post',
            text: post.text,
            createdAt: post.createdAt,
            ...(post.facets ? { facets: JSON.parse(post.facets) } : {}),
            ...(post.embed ? { embed: JSON.parse(post.embed) } : {}),
            ...(post.langs ? { langs: post.langs.split(',') } : {}),
            ...(post.tags ? { tags: post.tags.split(',') } : {}),
          },
          indexedAt: post.indexedAt,
        },
      }))

      return {
        encoding: 'application/json' as const,
        body: {
          feed,
          cursor: result.cursor,
        },
      }
    },
  })
}
