import { InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from '../../../../context'
import { Server } from '../../../../lexicon'

export default function (server: Server, ctx: AppContext) {
  server.zone.stratos.feed.getPost({
    auth: ctx.authVerifier.standard,
    handler: async ({ params, auth }) => {
      const viewer = auth.credentials.iss
      const stratosStore = ctx.stratosStore
      if (!stratosStore) {
        throw new InvalidRequestError('Stratos integration not configured')
      }

      const post = await stratosStore.getPost(params.uri)
      if (!post) {
        throw new InvalidRequestError('Post not found', 'PostNotFound')
      }

      const viewerBoundaries =
        await ctx.stratosEnrollmentManager!.getBoundaries(viewer)

      // Boundary check: viewer must share at least one boundary with the post
      if (post.boundaries.length > 0) {
        const hasAccess = post.boundaries.some((b) =>
          viewerBoundaries.includes(b),
        )
        if (!hasAccess) {
          throw new InvalidRequestError(
            'Viewer does not share a boundary with this post',
            'BoundaryMismatch',
          )
        }
      }

      return {
        encoding: 'application/json' as const,
        body: {
          post: {
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
          },
        },
      }
    },
  })
}
