// SPDX-License-Identifier: GPL-3.0-or-later
import type { RisuCompatibilityEnvelope } from './contracts';

/**
 * Unedited compatibility export is byte-for-byte, not a lossy reconstruction.
 * Editors in later phases create a new revision; this path guarantees that an
 * import/inspect/export cycle cannot drop unknown fields or container files.
 */
export function exportUnmodifiedRisuSource(envelope: RisuCompatibilityEnvelope): Uint8Array {
  const bytes = envelope && envelope.raw && envelope.raw.sourceBytes;
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('Original source bytes are unavailable');
  return bytes.slice();
}

export async function sourceSha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto || !globalThis.crypto.subtle) throw new Error('WebCrypto SHA-256 is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function verifyUnmodifiedRoundTrip(envelope: RisuCompatibilityEnvelope): Promise<{ ok: boolean; sourceHash: string; exportedHash: string }> {
  const source = envelope.raw.sourceBytes;
  if (!(source instanceof Uint8Array)) throw new Error('Original source bytes are unavailable');
  const exported = exportUnmodifiedRisuSource(envelope);
  const [sourceHash, exportedHash] = await Promise.all([sourceSha256(source), sourceSha256(exported)]);
  return { ok: sourceHash === exportedHash, sourceHash, exportedHash };
}

