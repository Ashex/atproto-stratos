import { createServiceJwt } from '@atproto/xrpc-server'
import { Keypair } from '@atproto/crypto'

export async function createStratosSyncToken(
  keypair: Keypair,
  iss: string,
  aud: string,
  lxm: string,
): Promise<string> {
  return createServiceJwt({ iss, aud, lxm, keypair })
}
