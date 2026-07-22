import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
import type { Jwk, Jwks } from 'aws-jwt-verify/jwk'

const ALG = 'RS256'
const KID = 'test-key'

const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true })
const publicJwk = await exportJWK(publicKey)

// jose types `kty` as optional (generic across key types); it's always
// present for a real exported RSA public key, so the cast is safe here.
export const jwks: Jwks = {
  keys: [{ ...publicJwk, kid: KID, alg: ALG, use: 'sig' } as Jwk]
}

export interface SignTokenOverrides {
  issuer?: string
  audience?: string
  tokenUse?: 'id' | 'access'
  sub?: string
  email?: string
  expiresAtSeconds?: number
}

// Defaults mint a token that passes verification against the real, configured
// user pool/client (read from process.env, same source config.ts reads) —
// each field is overridable to produce the rejection cases (expired,
// wrong-issuer, wrong-audience) deterministically, with no live Cognito call.
export async function signToken (overrides: SignTokenOverrides = {}): Promise<string> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID as string
  const clientId = process.env.COGNITO_CLIENT_ID as string
  const region = userPoolId.split('_')[0]

  const issuer = overrides.issuer ?? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`
  const audience = overrides.audience ?? clientId
  const tokenUse = overrides.tokenUse ?? 'id'
  const sub = overrides.sub ?? randomUUID()
  const email = overrides.email ?? `${sub}@example.com`
  const expiresAtSeconds = overrides.expiresAtSeconds ?? Math.floor(Date.now() / 1000) + 3600

  return await new SignJWT({ token_use: tokenUse, email })
    .setProtectedHeader({ alg: ALG, kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(sub)
    .setExpirationTime(expiresAtSeconds)
    .sign(privateKey)
}

export function tamperSignature (token: string): string {
  const [header, payload, signature] = token.split('.')
  const flippedChar = signature.at(-1) === 'A' ? 'B' : 'A'
  return `${header}.${payload}.${signature.slice(0, -1)}${flippedChar}`
}
