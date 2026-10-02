import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/** Derive Chrome's ID from a canonical base64 SPKI public key, rejecting corrupt keys. */
export function extensionIdFromKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(key)) throw new Error('Invalid extension public key.');
  const der = Buffer.from(key, 'base64');
  if (der.toString('base64') !== key) throw new Error('Invalid extension public key encoding.');
  const parsed = createPublicKey({ key: der, type: 'spki', format: 'der' });
  if (!der.equals(parsed.export({ type: 'spki', format: 'der' }))) throw new Error('Invalid extension public key DER.');
  const digest = createHash('sha256').update(der).digest().subarray(0, 16);
  return [...digest].map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
}

/** Read or prepare an identity without creating a profile before installation succeeds. */
export function prepareExtensionIdentity(keyPath, existingKey) {
  const key = existsSync(keyPath) ? readFileSync(keyPath, 'utf8').trim()
    : existingKey ?? generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { key, id: extensionIdFromKey(key) };
}
