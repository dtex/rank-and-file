// The OAuth 2 authorization-code flow with PKCE, shared by every provider.
import { createHash, randomBytes } from 'node:crypto'

const b64 = (buf) => buf.toString('base64url')

/** Values to remember (in a signed cookie) between sending the user away and their return. */
export function newAttempt() {
  return { state: b64(randomBytes(24)), verifier: b64(randomBytes(32)) }
}

export function authorizeUrl(provider, { clientId }, { state, verifier }, redirectUri) {
  const url = new URL(provider.authorizeUrl)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: provider.scope,
    state,
    code_challenge: b64(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  })
  return url.href
}

/** Trade the code for an access token, then ask the provider who this is. */
export async function completeSignIn(provider, { clientId, clientSecret }, { code, verifier }, redirectUri, fetchImpl = fetch) {
  const res = await fetchImpl(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    }).toString(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`${provider.name} did not accept the sign-in (${body.error || res.status})`)
  return provider.profile(body.access_token, fetchImpl)
}
