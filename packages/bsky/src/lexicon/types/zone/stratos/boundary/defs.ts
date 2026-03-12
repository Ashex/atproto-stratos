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

const is$typed = _is$typed,
  validate = _validate
const id = 'zone.stratos.boundary.defs'

export interface Domain {
  $type?: 'zone.stratos.boundary.defs#Domain'
  value: string
}

const hashDomain = 'Domain'

export function isDomain<V>(v: V) {
  return is$typed(v, id, hashDomain)
}

export function validateDomain<V>(v: V) {
  return validate<Domain & V>(v, id, hashDomain)
}

export interface Domains {
  $type?: 'zone.stratos.boundary.defs#Domains'
  values: Domain[]
}

const hashDomains = 'Domains'

export function isDomains<V>(v: V) {
  return is$typed(v, id, hashDomains)
}

export function validateDomains<V>(v: V) {
  return validate<Domains & V>(v, id, hashDomains)
}
