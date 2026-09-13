import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { CadSource } from '@/core/ir/types';

export const MAX_CAD_SOURCE_BYTES = 25 * 1024 * 1024;

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** Preserve all bytes, including CAD units, assemblies and exact curved surfaces. */
export function createCadSource(bytes: Uint8Array, format: CadSource['format'], fileName: string): CadSource {
  if (!bytes.byteLength || bytes.byteLength > MAX_CAD_SOURCE_BYTES) throw new Error('CAD source must contain 1 byte to 25 MiB.');
  if (!fileName || fileName.length > 1024) throw new Error('CAD source filename must contain 1 to 1024 characters.');
  if (format !== 'step' && format !== 'iges') throw new Error('Unsupported CAD source format.');
  return { format, file_name: fileName, media_type: format === 'step' ? 'model/step' : 'model/iges', encoding: 'base64',
    data: encode(bytes), content_hash: `sha256:${bytesToHex(sha256(bytes))}`, byte_length: bytes.byteLength };
}

/** Byte integrity only; the CAD kernel validates the BRep during import/export. */
export function validateCadSource(source: CadSource): Uint8Array {
  if ((source.format !== 'step' && source.format !== 'iges') || source.media_type !== `model/${source.format}` || source.encoding !== 'base64') {
    throw new Error('CAD source format, media type and encoding are inconsistent.');
  }
  if (!Number.isSafeInteger(source.byte_length) || source.byte_length < 1 || source.byte_length > MAX_CAD_SOURCE_BYTES
    || source.data.length > Math.ceil(MAX_CAD_SOURCE_BYTES / 3) * 4) throw new Error('CAD source exceeds the 25 MiB safety limit or is empty.');
  const binary = atob(source.data);
  if (binary.length !== source.byte_length) throw new Error('CAD source byte length does not match its metadata.');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (`sha256:${bytesToHex(sha256(bytes))}` !== source.content_hash) throw new Error('CAD source SHA-256 does not match its bytes.');
  return bytes;
}
