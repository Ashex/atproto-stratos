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
import type * as AppBskyFeedDefs from '../../../app/bsky/feed/defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'zone.stratos.feed.getPost'

export type QueryParams = {
  uri: string
}
export type InputSchema = undefined

export interface OutputSchema {
  post: AppBskyFeedDefs.FeedViewPost
}

export type HandlerInput = void

export interface HandlerSuccess {
  encoding: 'application/json'
  body: OutputSchema
  headers?: { [key: string]: string }
}

export interface HandlerError {
  status: number
  message?: string
  error?: 'PostNotFound' | 'NotEnrolled' | 'BoundaryMismatch'
}

export type HandlerOutput = HandlerError | HandlerSuccess
