import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';

it('upgrades v3 drafts without data loss and prevents older writers from deleting new CAD blobs', async () => {
  let retired = false;
  const old = await openDB('fem-modeler', 3, {
    upgrade(db) { for (const name of ['project-drafts', 'draft-versions', 'draft-assets']) db.createObjectStore(name); },
    blocking() { retired = true; old.close(); },
  });
  const ir = createDefaultProject(); ir.meta.schema_version = '0.3.0'; ir.meta.project_name = 'Existing v3 project';
  await old.put('project-drafts', { key: ir.meta.project_id, projectId: ir.meta.project_id, projectName: ir.meta.project_name,
    savedAt: '2026-01-01T00:00:00Z', schemaVersion: '0.3.0', versionId: 'old-head', irJson: JSON.stringify(ir) }, ir.meta.project_id);
  const { loadProjectDraft } = await import('@/lib/project-draft-storage');
  const loaded = await loadProjectDraft(ir.meta.project_id);
  expect(retired).toBe(true);
  expect(loaded?.meta.project_name).toBe('Existing v3 project');
  expect(loaded?.meta.schema_version).toBe('0.4.0');
  await expect(openDB('fem-modeler', 3)).rejects.toMatchObject({ name: 'VersionError' });
});
