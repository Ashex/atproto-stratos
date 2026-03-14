import { InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from '../../../../context'
import { Server } from '../../../../lexicon'

export default function (server: Server, ctx: AppContext) {
  server.zone.stratos.feed.getAuthorFeed({
    auth: ctx.authVerifier.standard,
    handler: async ({ params, auth }) => {
      const viewer = auth.credentials.iss
      const stratosStore = ctx.stratosStore
      if (!stratosStore) {
        throw new InvalidRequestError('Stratos integration not configured')
      }

      // Resolve handle to DID — params.actor can be a handle or DID
      const [actorDid] = await ctx.hydrator.actor.getDids([params.actor])
      if (!actorDid) {
        throw new InvalidRequestError('Profile not found')
      }

      const viewerBoundaries =
        await ctx.stratosEnrollmentManager!.getBoundaries(viewer)
      console.log(`[stratos] getAuthorFeed: viewer=${viewer} actor=${actorDid} viewerBoundaries=`, viewerBoundaries)
      if (viewerBoundaries.length === 0) {
        return {
          encoding: 'application/json' as const,
          body: { feed: [] },
        }
      }

      const result = await stratosStore.getAuthorFeed({
        actorDid,
        viewerBoundaries,
        boundary: params.boundary,
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
