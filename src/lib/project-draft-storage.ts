import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GeometryAsset, ProjectIR } from '@/core/ir/types';
import { normalizeAndValidateProjectData } from '@/export/project/project-file-schema';
import { generateId } from '@/core/ir/id-generator';

const DB_NAME = 'fem-modeler';
const DB_VERSION = 3;
const DRAFT_STORE = 'project-drafts';
const VERSION_STORE = 'draft-versions';
const ASSET_STORE = 'draft-assets';
export const MAX_DRAFT_VERSIONS = 5;
export const MAX_DRAFT_STORAGE_BYTES = 128 * 1024 * 1024;

export interface DraftSummary {
  projectId: string;
  projectName: string;
  savedAt: string;
  schemaVersion: string;
  versionId: string;
}
interface StoredDraftRow extends DraftSummary {
  key: string;
  irJson: string;
  assetKeys?: string[];
  sequence?: number;
  savedOrder?: number;
}
interface StoredAsset { data: string }
interface FEMModelerDraftDB extends DBSchema {
  [DRAFT_STORE]: { key: string; value: StoredDraftRow };
  [VERSION_STORE]: { key: string; value: StoredDraftRow };
  [ASSET_STORE]: { key: string; value: StoredAsset };
}
export interface StoredProjectDraft extends DraftSummary { key: string; ir: ProjectIR }
export class DraftConflictError extends Error {
  constructor() { super('This project was saved in another tab. Restore its latest version or save your work to a file before continuing.'); this.name = 'DraftConflictError'; }
}

let dbPromise: Promise<IDBPDatabase<FEMModelerDraftDB>> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const assetKeyCache = new WeakMap<GeometryAsset, Promise<string>>();

/** Saves, deletions and migrations share a queue, including work already in flight. */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const pending = queue.then(work, work);
  queue = pending.catch(() => undefined);
  return pending;
}
function getDraftDb(): Promise<IDBPDatabase<FEMModelerDraftDB>> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable in this environment.');
  if (!dbPromise) {
    dbPromise = openDB<FEMModelerDraftDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE);
        if (!db.objectStoreNames.contains(VERSION_STORE)) db.createObjectStore(VERSION_STORE);
        if (!db.objectStoreNames.contains(ASSET_STORE)) db.createObjectStore(ASSET_STORE);
      },
      blocking() { void dbPromise?.then((db) => db.close()); dbPromise = null; },
      terminated() { dbPromise = null; },
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

export function createProjectDraftRecord(ir: ProjectIR, savedAt = new Date().toISOString()): StoredProjectDraft {
  return { key: ir.meta.project_id, savedAt, projectId: ir.meta.project_id, projectName: ir.meta.project_name,
    schemaVersion: ir.meta.schema_version, versionId: generateId('draft'), ir };
}
export function summarizeProjectDraft(record: DraftSummary): DraftSummary {
  return { projectId: record.projectId, projectName: record.projectName, savedAt: record.savedAt,
    schemaVersion: record.schemaVersion, versionId: record.versionId };
}
async function assetKey(asset: GeometryAsset): Promise<string> {
  let key = assetKeyCache.get(asset);
  if (!key) {
    key = crypto.subtle.digest('SHA-256', new TextEncoder().encode(asset.data)).then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    // Only immutable assets can be safely memoized across edits.
    if (Object.isFrozen(asset)) assetKeyCache.set(asset, key);
  }
  return key;
}
async function toRow(record: StoredProjectDraft): Promise<StoredDraftRow> {
  const keys = await Promise.all(record.ir.assets.map(assetKey));
  return { key: record.key, ...summarizeProjectDraft(record), assetKeys: keys,
    irJson: JSON.stringify({ ...record.ir, assets: record.ir.assets.map((asset) => ({ ...asset, data: '' })) }) };
}
async function fromRow(row: StoredDraftRow): Promise<StoredProjectDraft> {
  const json = JSON.parse(row.irJson);
  if (row.assetKeys) {
    const db = await getDraftDb();
    const assets = await Promise.all(row.assetKeys.map((key) => db.get(ASSET_STORE, key)));
    json.assets = json.assets.map((asset: GeometryAsset, index: number) => {
      if (!assets[index]) throw new Error('A stored geometry asset is missing.');
      return { ...asset, data: assets[index]!.data };
    });
  }
  const normalized = normalizeAndValidateProjectData(json);
  if (!normalized.success || !normalized.data) throw new Error(normalized.error ?? 'Stored project draft is invalid.');
  return { key: row.key, ...summarizeProjectDraft(row), ir: normalized.data };
}

async function migrateLegacyDraft(db: IDBPDatabase<FEMModelerDraftDB>): Promise<void> {
  const tx = db.transaction(DRAFT_STORE, 'readwrite');
  const legacy = await tx.store.get('current');
  if (legacy && !legacy.versionId) {
    const existing = await tx.store.get(legacy.projectId);
    if (!existing || existing.savedAt < legacy.savedAt || legacy.projectId === 'current') {
      await tx.store.put({ ...legacy, key: legacy.projectId, versionId: legacy.versionId ?? generateId('draft') }, legacy.projectId);
    }
    if (legacy.projectId !== 'current') await tx.store.delete('current');
  }
  await tx.done;
}

/** expectedVersion=null requires a new head; omitted retains the explicit storage API's overwrite behavior. */
export function saveProjectDraft(ir: ProjectIR, savedAt = new Date().toISOString(), options: { expectedVersion?: string | null; getExpectedVersion?: () => string | null; shouldSave?: () => boolean } = {}): Promise<DraftSummary> {
  return enqueue(async () => {
    const db = await getDraftDb();
    await migrateLegacyDraft(db);
    if (options.shouldSave && !options.shouldSave()) throw new DOMException('Save cancelled.', 'AbortError');
    const record = createProjectDraftRecord(ir, savedAt);
    const row = await toRow(record);
    if (options.shouldSave && !options.shouldSave()) throw new DOMException('Save cancelled.', 'AbortError');
    const tx = db.transaction([DRAFT_STORE, VERSION_STORE, ASSET_STORE], 'readwrite');
    // Consume done rejection for an intentional abort as well as request failure.
    const done = tx.done;
    void done.catch(() => undefined);
    try {
      const existingHeads = await tx.objectStore(DRAFT_STORE).getAll();
      const previous = existingHeads.find((head) => head.projectId === record.projectId);
      row.savedOrder = existingHeads.reduce((maximum, head) => Math.max(maximum, head.savedOrder ?? 0), 0) + 1;
      const expected = options.getExpectedVersion ? options.getExpectedVersion() : options.expectedVersion;
      if (expected !== undefined && (previous?.versionId ?? null) !== expected) throw new DraftConflictError();
      row.sequence = (previous?.sequence ?? 0) + 1;
      if (previous) await tx.objectStore(VERSION_STORE).put(previous, previous.versionId);
      await tx.objectStore(DRAFT_STORE).put(row, record.projectId);
      for (let i = 0; i < ir.assets.length; i++) {
        const key = row.assetKeys![i];
        if (!await tx.objectStore(ASSET_STORE).getKey(key)) await tx.objectStore(ASSET_STORE).put({ data: ir.assets[i].data }, key);
      }
      const versions = await tx.objectStore(VERSION_STORE).getAll();
      const projectVersions = versions.filter((item) => item.projectId === record.projectId).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0) || b.savedAt.localeCompare(a.savedAt));
      const removed = new Set(projectVersions.slice(MAX_DRAFT_VERSIONS).map((item) => item.versionId));
      for (const id of removed) await tx.objectStore(VERSION_STORE).delete(id);
      const heads = [row, ...existingHeads.filter((head) => head.projectId !== record.projectId)];
      const retained = [...heads, ...versions.filter((item) => !removed.has(item.versionId))];
      const referenced = new Set(retained.flatMap((item) => item.assetKeys ?? []));
      let bytes = retained.reduce((sum, item) => sum + item.irJson.length * 2, 0);
      let cursor = await tx.objectStore(ASSET_STORE).openCursor();
      while (cursor) {
        if (!referenced.has(cursor.key)) await cursor.delete();
        else bytes += cursor.value.data.length * 2;
        cursor = await cursor.continue();
      }
      if (bytes > MAX_DRAFT_STORAGE_BYTES) throw new Error('Draft storage exceeds 128 MiB. Export and delete an older project to free space.');
      await done;
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('fem-modeler-drafts');
        channel.postMessage(summarizeProjectDraft(record));
        channel.close();
      }
      return summarizeProjectDraft(record);
    } catch (error) { try { tx.abort(); } catch { /* already completed */ } throw error; }
  });
}

export async function listProjectDrafts(): Promise<DraftSummary[]> {
  await queue;
  const db = await getDraftDb();
  await migrateLegacyDraft(db);
  return (await db.getAll(DRAFT_STORE)).sort((a, b) => (b.savedOrder ?? 0) - (a.savedOrder ?? 0) || b.savedAt.localeCompare(a.savedAt)).map(summarizeProjectDraft);
}
export async function listProjectDraftVersions(projectId: string): Promise<DraftSummary[]> {
  await queue;
  const db = await getDraftDb();
  return (await db.getAll(VERSION_STORE)).filter((row) => row.projectId === projectId).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0) || b.savedAt.localeCompare(a.savedAt)).map(summarizeProjectDraft);
}
export async function readProjectDraftRecord(projectId?: string, versionId?: string): Promise<StoredProjectDraft | null> {
  await queue;
  const db = await getDraftDb();
  await migrateLegacyDraft(db);
  const id = projectId ?? (await listProjectDrafts())[0]?.projectId;
  if (!id) return null;
  const row = versionId ? await db.get(VERSION_STORE, versionId) : await db.get(DRAFT_STORE, id);
  if (!row || row.projectId !== id) return null;
  return fromRow(row);
}
export async function loadProjectDraft(projectId?: string, versionId?: string): Promise<ProjectIR | null> {
  return (await readProjectDraftRecord(projectId, versionId))?.ir ?? null;
}
export async function getProjectDraftSummary(projectId?: string): Promise<DraftSummary | null> {
  const summaries = await listProjectDrafts();
  return (projectId ? summaries.find((item) => item.projectId === projectId) : summaries[0]) ?? null;
}
/** Without an ID, clears all drafts (for explicit reset). The UI always supplies a project ID. */
export function clearProjectDraft(projectId?: string): Promise<void> {
  return enqueue(async () => {
    const db = await getDraftDb();
    await migrateLegacyDraft(db);
    const tx = db.transaction([DRAFT_STORE, VERSION_STORE, ASSET_STORE], 'readwrite');
    if (!projectId) {
      await Promise.all([tx.objectStore(DRAFT_STORE).clear(), tx.objectStore(VERSION_STORE).clear(), tx.objectStore(ASSET_STORE).clear()]);
    } else {
      await tx.objectStore(DRAFT_STORE).delete(projectId);
      for (const row of await tx.objectStore(VERSION_STORE).getAll()) if (row.projectId === projectId) await tx.objectStore(VERSION_STORE).delete(row.versionId);
      const rows = [...await tx.objectStore(DRAFT_STORE).getAll(), ...await tx.objectStore(VERSION_STORE).getAll()];
      const referenced = new Set(rows.flatMap((row) => row.assetKeys ?? []));
      for (const key of await tx.objectStore(ASSET_STORE).getAllKeys()) if (!referenced.has(key)) await tx.objectStore(ASSET_STORE).delete(key);
    }
    await tx.done;
  });
}

/** O(entities + fields), never serializes or traverses result values / STL data. */
export function estimateProjectDraftBytes(ir: ProjectIR): number {
  const geometry = ir.geometry;
  const entities = geometry.bodies.length + geometry.faces.length + geometry.edges.length + geometry.vertices.length;
  const resultBytes = ir.results.reduce((sum, result) => sum + result.fields.reduce((fieldSum, field) => fieldSum + field.values.length * 16 + field.entity_ids.length * 32, 0), 0);
  const records = ir.materials.length + ir.sections.length + ir.boundary_conditions.length + ir.loads.length + ir.analysis_cases.length + ir.named_selections.length + ir.audit_trail.length;
  return 4096 + (entities + records) * 1024 + ir.assets.reduce((sum, asset) => sum + asset.data.length * 2, 0) + resultBytes;
}
