/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../lexicons'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../util'

const is$typed = _is$typed,
  validate = _validate
const id = 'zone.stratos.defs'

export interface Source {
  $type?: 'zone.stratos.defs#source'
  vary: 'authenticated' | 'unauthenticated' | (string & {})
  subject: SubjectRef
  service: string
}

const hashSource = 'source'

export function isSource<V>(v: V) {
  return is$typed(v, id, hashSource)
}

export function validateSource<V>(v: V) {
  return validate<Source & V>(v, id, hashSource)
}

export interface SubjectRef {
  $type?: 'zone.stratos.defs#subjectRef'
  uri: string
  cid: string
}

const hashSubjectRef = 'subjectRef'

export function isSubjectRef<V>(v: V) {
  return is$typed(v, id, hashSubjectRef)
}

export function validateSubjectRef<V>(v: V) {
  return validate<SubjectRef & V>(v, id, hashSubjectRef)
}
