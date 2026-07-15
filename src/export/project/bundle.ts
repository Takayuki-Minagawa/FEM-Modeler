import JSZip from 'jszip';
import { Unzip, UnzipInflate } from 'fflate';
import { saveAs } from 'file-saver';
import type { GeometryAsset, ProjectIR } from '@/core/ir/types';
import { sanitizeArtifactName } from '@/export/shared/artifact-sanitization';
import { parseProjectFile, type LoadResult } from './load';
import { serializeProject } from './save';

const BUNDLE_FORMAT = 'fem-modeler-bundle';
const BUNDLE_VERSION = 2;
const PROJECT_PATH = 'project.fem.json';
const MANIFEST_PATH = 'bundle_manifest.json';
const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;
const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_PROJECT_JSON_BYTES = 20 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

interface BundleAssetManifest {
  id: string;
  path: string;
  content_hash: string;
  sha256: string;
  byte_length: number;
}

interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  project_file: typeof PROJECT_PATH;
  project_sha256: string;
  project_byte_length: number;
  created_at: string;
  assets: BundleAssetManifest[];
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function fnv1a64(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * prime) & mask;
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assetPath(asset: GeometryAsset): string {
  return `assets/${sanitizeArtifactName(asset.id, 'asset', 80)}.stl`;
}

function projectWithoutEmbeddedAssetData(ir: ProjectIR): ProjectIR {
  return {
    ...ir,
    assets: ir.assets.map((asset) => ({ ...asset, data: '' })),
  };
}

function isSafeBundlePath(path: string): boolean {
  return !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function parseManifest(text: string): BundleManifest {
  const value = JSON.parse(text) as Partial<BundleManifest>;
  if (value.format !== BUNDLE_FORMAT || value.version !== BUNDLE_VERSION || value.project_file !== PROJECT_PATH) {
    throw new Error('Unsupported FEM bundle format or version.');
  }
  if (typeof value.project_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.project_sha256)
    || !Number.isInteger(value.project_byte_length)
    || (value.project_byte_length ?? 0) < 1
    || (value.project_byte_length ?? 0) > MAX_PROJECT_JSON_BYTES) {
    throw new Error('Bundle manifest contains invalid project integrity metadata.');
  }
  if (!Array.isArray(value.assets)) throw new Error('Bundle manifest assets must be an array.');
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const asset of value.assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id || typeof asset.path !== 'string'
      || !isSafeBundlePath(asset.path) || !asset.path.startsWith('assets/')
      || typeof asset.content_hash !== 'string' || !asset.content_hash.startsWith('fnv1a64:')
      || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)
      || !Number.isInteger(asset.byte_length) || asset.byte_length < 0 || asset.byte_length > MAX_ASSET_BYTES) {
      throw new Error('Bundle manifest contains an invalid asset entry.');
    }
    if (ids.has(asset.id) || paths.has(asset.path)) throw new Error('Bundle manifest contains duplicate asset IDs or paths.');
    ids.add(asset.id);
    paths.add(asset.path);
  }
  return value as BundleManifest;
}

function extractionLimit(path: string): number {
  if (path === MANIFEST_PATH) return MAX_MANIFEST_BYTES;
  if (path === PROJECT_PATH) return MAX_PROJECT_JSON_BYTES;
  if (path.startsWith('assets/')) return MAX_ASSET_BYTES;
  return MAX_MANIFEST_BYTES;
}

/** Stream-inflate each entry and stop on actual output bytes, not ZIP metadata. */
function extractBundleEntries(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const pending = new Set<string>();
  let totalBytes = 0;
  let failure: Error | null = null;
  const unzip = new Unzip((file) => {
    if (failure) return;
    const isDirectory = file.name.endsWith('/');
    const normalizedPath = isDirectory ? file.name.slice(0, -1) : file.name;
    if (!isSafeBundlePath(normalizedPath)) {
      failure = new Error(`Bundle contains unsafe path "${file.name}".`);
      return;
    }
    if (isDirectory) return;
    if (entries.has(file.name) || pending.has(file.name)) {
      failure = new Error(`Bundle contains duplicate entry "${file.name}".`);
      return;
    }
    const limit = extractionLimit(file.name);
    if (file.originalSize !== undefined && file.originalSize > limit) {
      failure = new Error(`Bundle entry "${file.name}" declares more than its extraction limit.`);
      return;
    }
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    pending.add(file.name);
    file.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error) {
        failure = new Error(`Unable to inflate "${file.name}": ${error.message}`);
        file.terminate();
        return;
      }
      if (chunk) {
        entryBytes += chunk.byteLength;
        totalBytes += chunk.byteLength;
        if (entryBytes > limit || totalBytes > MAX_BUNDLE_BYTES) {
          failure = new Error(`Bundle entry "${file.name}" exceeds the actual extraction limit.`);
          file.terminate();
          return;
        }
        chunks.push(new Uint8Array(chunk));
      }
      if (final) {
        const bytes = new Uint8Array(entryBytes);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        entries.set(file.name, bytes);
        pending.delete(file.name);
      }
    };
    try {
      file.start();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(new Uint8Array(buffer), true);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }
  if (failure) throw failure;
  if (pending.size > 0) throw new Error('Bundle extraction did not finish every entry.');
  return entries;
}

/** Build a portable project ZIP. STL bytes are stored once, outside ProjectIR. */
export async function createProjectBundle(ir: ProjectIR): Promise<Blob> {
  const zip = new JSZip();
  const manifestAssets: BundleAssetManifest[] = [];
  let totalAssetBytes = 0;
  const paths = new Set<string>();

  for (const asset of ir.assets) {
    if (asset.data.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 4) {
      throw new Error(`Asset ${asset.id} exceeds the encoded 50 MB safety limit.`);
    }
    const bytes = decodeBase64(asset.data);
    if (bytes.byteLength !== asset.byte_length) throw new Error(`Asset ${asset.id} byte length does not match its metadata.`);
    if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error(`Asset ${asset.id} exceeds the 50 MB safety limit.`);
    const hash = fnv1a64(bytes);
    if (hash !== asset.content_hash) throw new Error(`Asset ${asset.id} content hash does not match its metadata.`);
    totalAssetBytes += bytes.byteLength;
    if (totalAssetBytes > MAX_BUNDLE_BYTES) throw new Error('Bundle assets exceed the 100 MB safety limit.');
    const path = assetPath(asset);
    if (paths.has(path)) throw new Error(`Asset path collision after filename sanitization: ${path}.`);
    paths.add(path);
    zip.file(path, bytes, { binary: true });
    manifestAssets.push({
      id: asset.id,
      path,
      content_hash: hash,
      sha256: await sha256(bytes),
      byte_length: bytes.byteLength,
    });
  }

  const projectText = serializeProject(projectWithoutEmbeddedAssetData(ir));
  const projectBytes = new TextEncoder().encode(projectText);
  if (projectBytes.byteLength === 0 || projectBytes.byteLength > MAX_PROJECT_JSON_BYTES) {
    throw new Error('Bundled project JSON is empty or exceeds the 20 MB safety limit.');
  }
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    project_file: PROJECT_PATH,
    project_sha256: await sha256(projectBytes),
    project_byte_length: projectBytes.byteLength,
    created_at: new Date().toISOString(),
    assets: manifestAssets,
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  const manifestBytes = new TextEncoder().encode(manifestText);
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('Bundle manifest exceeds the 1 MB safety limit.');
  if (projectBytes.byteLength + manifestBytes.byteLength + totalAssetBytes > MAX_BUNDLE_BYTES) {
    throw new Error('Bundle uncompressed content exceeds the 100 MB safety limit.');
  }
  zip.file(PROJECT_PATH, projectBytes, { binary: true });
  zip.file(MANIFEST_PATH, manifestBytes, { binary: true });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (blob.size > MAX_BUNDLE_BYTES) throw new Error('Generated bundle exceeds the 100 MB safety limit.');
  return blob;
}

export async function downloadProjectBundle(ir: ProjectIR): Promise<void> {
  const blob = await createProjectBundle(ir);
  saveAs(blob, `${sanitizeArtifactName(ir.meta.project_name)}.fem.zip`);
}

/** Read, validate, and hydrate a portable project ZIP. */
export async function parseProjectBundle(buffer: ArrayBuffer): Promise<LoadResult> {
  try {
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BUNDLE_BYTES) {
      throw new Error('Bundle is empty or exceeds the 100 MB safety limit.');
    }
    const entries = extractBundleEntries(buffer);
    const manifestBytes = entries.get(MANIFEST_PATH);
    const projectBytes = entries.get(PROJECT_PATH);
    if (!manifestBytes || !projectBytes) throw new Error('Bundle manifest or project file is missing.');
    const manifest = parseManifest(new TextDecoder().decode(manifestBytes));
    const declaredUncompressedBytes = manifest.project_byte_length
      + manifestBytes.byteLength
      + manifest.assets.reduce((sum, item) => sum + item.byte_length, 0);
    if (!Number.isSafeInteger(declaredUncompressedBytes) || declaredUncompressedBytes > MAX_BUNDLE_BYTES) {
      throw new Error('Bundle declares more than 100 MB of uncompressed content.');
    }
    const allowedPaths = new Set([MANIFEST_PATH, PROJECT_PATH, ...manifest.assets.map((item) => item.path)]);
    for (const path of entries.keys()) {
      if (!allowedPaths.has(path)) throw new Error(`Bundle contains undeclared file "${path}".`);
    }
    if (projectBytes.byteLength !== manifest.project_byte_length
      || await sha256(projectBytes) !== manifest.project_sha256) {
      throw new Error('Bundled project failed SHA-256 integrity verification.');
    }
    const projectRaw = JSON.parse(new TextDecoder().decode(projectBytes)) as { assets?: GeometryAsset[] };
    if (!Array.isArray(projectRaw.assets)) throw new Error('Bundled ProjectIR assets are missing.');
    if (projectRaw.assets.length !== manifest.assets.length) throw new Error('Bundle asset count does not match ProjectIR.');

    const projectAssets = new Map(projectRaw.assets.map((asset) => [asset.id, asset]));
    let extractedBytes = manifestBytes.byteLength + projectBytes.byteLength;
    for (const item of manifest.assets) {
      const projectAsset = projectAssets.get(item.id);
      const bytes = entries.get(item.path);
      if (!projectAsset || !bytes) throw new Error(`Bundle asset ${item.id} is missing.`);
      extractedBytes += bytes.byteLength;
      if (extractedBytes > MAX_BUNDLE_BYTES || bytes.byteLength !== item.byte_length) {
        throw new Error(`Bundle asset ${item.id} violates the size manifest.`);
      }
      const hash = fnv1a64(bytes);
      if (hash !== item.content_hash || hash !== projectAsset.content_hash
        || projectAsset.byte_length !== item.byte_length) {
        throw new Error(`Bundle asset ${item.id} failed integrity verification.`);
      }
      if (await sha256(bytes) !== item.sha256) {
        throw new Error(`Bundle asset ${item.id} failed SHA-256 verification.`);
      }
      projectAsset.data = encodeBase64(bytes);
    }

    return parseProjectFile(JSON.stringify(projectRaw));
  } catch (error) {
    return { success: false, error: `FEM bundle error: ${error instanceof Error ? error.message : String(error)}` };
  }
}
