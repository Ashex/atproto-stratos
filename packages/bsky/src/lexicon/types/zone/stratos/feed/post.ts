/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../lexicons'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../util'
import type * as ZoneStratosDefs from '../defs.js'
import type * as ZoneStratosBoundaryDefs from '../boundary/defs.js'
import type * as AppBskyRichtextFacet from '../../../app/bsky/richtext/facet.js'
import type * as AppBskyEmbedImages from '../../../app/bsky/embed/images.js'
import type * as AppBskyEmbedVideo from '../../../app/bsky/embed/video.js'
import type * as AppBskyEmbedExternal from '../../../app/bsky/embed/external.js'
import type * as AppBskyEmbedRecord from '../../../app/bsky/embed/record.js'
import type * as AppBskyEmbedRecordWithMedia from '../../../app/bsky/embed/recordWithMedia.js'
import type * as ComAtprotoLabelDefs from '../../../com/atproto/label/defs.js'
import type * as ComAtprotoRepoStrongRef from '../../../com/atproto/repo/strongRef.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'zone.stratos.feed.post'

export interface Record {
  $type?: 'zone.stratos.feed.post'
  source?: $Typed<ZoneStratosDefs.Source>
  text?: string
  boundary?: $Typed<ZoneStratosBoundaryDefs.Domains> | { $type: string }
  facets?: AppBskyRichtextFacet.Main[]
  reply?: ReplyRef
  embed?:
    | $Typed<AppBskyEmbedImages.Main>
    | $Typed<AppBskyEmbedVideo.Main>
    | $Typed<AppBskyEmbedExternal.Main>
    | $Typed<AppBskyEmbedRecord.Main>
    | $Typed<AppBskyEmbedRecordWithMedia.Main>
    | { $type: string }
  langs?: string[]
  labels?: $Typed<ComAtprotoLabelDefs.SelfLabels> | { $type: string }
  tags?: string[]
  createdAt: string
}

const hashRecord = 'main'

export function isRecord<V>(v: V) {
  return is$typed(v, id, hashRecord)
}

export function validateRecord<V>(v: V) {
  return validate<Record & V>(v, id, hashRecord)
}

export interface ReplyRef {
  $type?: 'zone.stratos.feed.post#replyRef'
  root: ComAtprotoRepoStrongRef.Main
  parent: ComAtprotoRepoStrongRef.Main
}

const hashReplyRef = 'replyRef'

export function isReplyRef<V>(v: V) {
  return is$typed(v, id, hashReplyRef)
}

export function validateReplyRef<V>(v: V) {
  return validate<ReplyRef & V>(v, id, hashReplyRef)
}
