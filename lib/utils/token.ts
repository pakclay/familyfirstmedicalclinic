import { randomBytes } from "crypto"

/** Cryptographically random, single-purpose token for a patient's queue status link (§10). */
export function generateAccessToken(): string {
  return randomBytes(24).toString("base64url")
}
