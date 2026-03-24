import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProjectIR } from '@/core/ir/types';

const DB_NAME = 'fem-modeler';
const DB_VERSION = 2;
const DRAFT_STORE = 'project-drafts';
const CURRENT_DRAFT_KEY = 'current';

interface StoredDraftRow {
  key: string;
  savedAt: string;
  projectId: string;
  projectName: string;
  schemaVersion: string;
  irJson: string;
}

interface FEMModelerDraftDB extends DBSchema {
  [DRAFT_STORE]: {
    key: string;
    value: StoredDraftRow;
  };
}

export interface StoredProjectDraft {
  key: typeof CURRENT_DRAFT_KEY;
  savedAt: string;
  projectId: string;
  projectName: string;
  schemaVersion: string;
  ir: ProjectIR;
}

export interface DraftSummary {
  projectId: string;
  projectName: string;
  savedAt: string;
  schemaVersion: string;
}

let dbPromise: Promise<IDBPDatabase<FEMModelerDraftDB>> | null = null;

function ensureIndexedDb(): void {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable in this environment.');
  }
}

function getDraftDb(): Promise<IDBPDatabase<FEMModelerDraftDB>> {
  ensureIndexedDb();
  if (!dbPromise) {
    dbPromise = openDB<FEMModelerDraftDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export function createProjectDraftRecord(
  ir: ProjectIR,
  savedAt = new Date().toISOString(),
): StoredProjectDraft {
  return {
    key: CURRENT_DRAFT_KEY,
    savedAt,
    projectId: ir.meta.project_id,
    projectName: ir.meta.project_name,
    schemaVersion: ir.meta.schema_version,
    ir,
  };
}

export function summarizeProjectDraft(record: StoredProjectDraft): DraftSummary {
  return {
    projectId: record.projectId,
    projectName: record.projectName,
    savedAt: record.savedAt,
    schemaVersion: record.schemaVersion,
  };
}

function toRow(record: StoredProjectDraft): StoredDraftRow {
  return {
    key: record.key,
    savedAt: record.savedAt,
    projectId: record.projectId,
    projectName: record.projectName,
    schemaVersion: record.schemaVersion,
    irJson: JSON.stringify(record.ir),
  };
}

function fromRow(row: StoredDraftRow): StoredProjectDraft {
  return {
    key: CURRENT_DRAFT_KEY,
    savedAt: row.savedAt,
    projectId: row.projectId,
    projectName: row.projectName,
    schemaVersion: row.schemaVersion,
    ir: JSON.parse(row.irJson) as ProjectIR,
  };
}

export async function saveProjectDraft(
  ir: ProjectIR,
  savedAt = new Date().toISOString(),
): Promise<DraftSummary> {
  const record = createProjectDraftRecord(ir, savedAt);
  const row = toRow(record);
  const db = await getDraftDb();
  await db.put(DRAFT_STORE, row, CURRENT_DRAFT_KEY);
  return summarizeProjectDraft(record);
}

export async function readProjectDraftRecord(): Promise<StoredProjectDraft | null> {
  const db = await getDraftDb();
  const row = await db.get(DRAFT_STORE, CURRENT_DRAFT_KEY);
  if (!row) return null;
  return fromRow(row);
}

export async function loadProjectDraft(): Promise<ProjectIR | null> {
  const record = await readProjectDraftRecord();
  return record?.ir ?? null;
}

export async function getProjectDraftSummary(): Promise<DraftSummary | null> {
  const db = await getDraftDb();
  const row = await db.get(DRAFT_STORE, CURRENT_DRAFT_KEY);
  if (!row) return null;
  return {
    projectId: row.projectId,
    projectName: row.projectName,
    savedAt: row.savedAt,
    schemaVersion: row.schemaVersion,
  };
}

export async function clearProjectDraft(): Promise<void> {
  const db = await getDraftDb();
  await db.delete(DRAFT_STORE, CURRENT_DRAFT_KEY);
}
