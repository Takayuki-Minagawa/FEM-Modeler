import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface Head { projectId: string; projectName: string; versionId: string; irJson: string }
async function heads(page: Page): Promise<Head[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('fem-modeler');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('project-drafts')) { db.close(); resolve([]); return; }
      const tx = db.transaction('project-drafts', 'readonly');
      const get = tx.objectStore('project-drafts').getAll();
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }));
}
async function downloadProject(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await event;
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}
async function createTemplate(page: Page, name: string) {
  await page.getByRole('dialog', { name: 'FEM Modeler' }).getByRole('button', { name, exact: false }).click();
  await expect(page.getByRole('dialog', { name: 'FEM Modeler' })).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('fem-modeler-lang')) localStorage.setItem('fem-modeler-lang', 'en'); });
  await page.goto('./');
  await expect(page.getByRole('dialog', { name: 'FEM Modeler' })).toBeVisible();
});

test('protects a saved draft during startup delay and language change, then restores versions and projects', async ({ page }) => {
  await createTemplate(page, '2D Frame');
  await expect.poll(async () => (await heads(page)).length).toBe(1);
  const original = (await heads(page))[0];
  await page.reload();
  const start = page.getByRole('dialog', { name: 'FEM Modeler' });
  await expect(start.getByText('Auto-saved draft available')).toBeVisible();
  await page.waitForTimeout(6100);
  expect((await heads(page))[0]).toEqual(original);
  await start.getByRole('button', { name: '日本語に切り替え' }).click();
  await page.waitForTimeout(6100);
  expect((await heads(page))[0]).toEqual(original);
  await start.getByRole('button', { name: 'Switch to English' }).click();
  await start.getByRole('button', { name: 'Restore Draft', exact: true }).click();
  expect((await downloadProject(page)).meta.project_id).toBe(original.projectId);
  await page.getByRole('combobox', { name: 'Display unit system' }).selectOption('mm-N-s');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await createTemplate(page, 'Empty Project');
  await expect.poll(async () => (await heads(page)).length).toBe(2);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const recent = page.getByRole('region', { name: 'Recent projects' });
  await recent.getByRole('button', { name: original.projectName, exact: true }).click();
  expect((await downloadProject(page)).meta.project_id).toBe(original.projectId);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const row = recent.locator('div.border').filter({ has: page.getByRole('button', { name: original.projectName, exact: true }) });
  await row.getByRole('button', { name: 'Previous versions' }).click();
  await expect(row.getByRole('button', { name: /Restore version:/ }).first()).toBeVisible();
  await row.getByRole('button', { name: /Restore version:/ }).first().click();
  expect((await downloadProject(page)).meta.project_id).toBe(original.projectId);
});

test('creates, resizes, deletes and undoes geometry, with a real JSON download', async ({ page }) => {
  await createTemplate(page, 'Empty Project');
  await page.getByRole('button', { name: 'Create Shape', exact: true }).click();
  const before = await downloadProject(page);
  expect(before.geometry.bodies).toHaveLength(1);
  await page.getByText(before.geometry.bodies[0].name, { exact: true }).last().click();
  await page.getByRole('spinbutton', { name: 'Dimension width', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Apply dimensions', exact: true }).click();
  const changed = await downloadProject(page);
  expect(changed.geometry.bodies[0].metadata.width).toBe(3);
  expect(changed.geometry.bodies[0].id).toBe(before.geometry.bodies[0].id);
  await page.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  expect((await downloadProject(page)).geometry.bodies).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const restored = await downloadProject(page);
  expect(restored.geometry).toEqual(changed.geometry);
  await page.getByRole('button', { name: 'Create Shape', exact: true }).click();
  await page.getByRole('button', { name: /Named Selections/ }).click();
  await page.getByRole('button', { name: 'body', exact: true }).click();
  const options = page.getByRole('listbox', { name: 'Selectable entities' }).getByRole('option');
  await options.nth(0).click(); await options.nth(1).click();
  await page.getByRole('button', { name: /Geometry/ }).click();
  await page.getByRole('button', { name: 'Delete Selected', exact: true }).click();
  expect((await downloadProject(page)).geometry.bodies).toHaveLength(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await downloadProject(page)).geometry.bodies).toHaveLength(2);
});

test('keeps modal focus stable through autosave and exports a template solver ZIP', async ({ page }) => {
  await createTemplate(page, '2D Frame');
  const help = page.getByRole('button', { name: 'Help', exact: true });
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'Operation Manual' });
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  await expect(close).toBeFocused();
  await page.waitForTimeout(1500);
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(help).toBeFocused();
  await page.getByRole('button', { name: /Solver Targets/ }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /OpenSeesPy Structural/ }).click();
  const zip = await pending;
  expect(zip.suggestedFilename()).toMatch(/\.zip$/);
  expect((await readFile((await zip.path())!)).subarray(0, 2).toString()).toBe('PK');
});

test('reloads the cached app offline and restores its IndexedDB project', async ({ page, context }) => {
  await createTemplate(page, '2D Frame');
  await expect.poll(async () => (await heads(page)).length).toBe(1);
  const original = (await heads(page))[0];
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  const start = page.getByRole('dialog', { name: 'FEM Modeler' });
  await expect(start.getByText('Auto-saved draft available')).toBeVisible();
  await start.getByRole('button', { name: 'Restore Draft', exact: true }).click();
  expect((await downloadProject(page)).meta.project_id).toBe(original.projectId);
  await context.setOffline(false);
  await page.reload();
  await expect(start).toBeVisible();
});

test('detects a second tab save and protects its newer head from local edits', async ({ page, context }) => {
  await createTemplate(page, '2D Frame');
  await expect.poll(async () => (await heads(page)).length).toBe(1);
  const first = (await heads(page))[0];
  const peer = await context.newPage();
  await peer.goto('./');
  await peer.getByRole('dialog', { name: 'FEM Modeler' }).getByRole('button', { name: 'Restore Draft', exact: true }).click();
  await expect(peer.getByRole('dialog', { name: 'FEM Modeler' })).toBeHidden();
  await peer.getByRole('combobox', { name: 'Display unit system' }).selectOption('mm-N-s');
  await expect.poll(async () => (await heads(peer))[0].versionId).not.toBe(first.versionId);
  const peerHead = (await heads(peer))[0];
  await expect(page.locator('[title]').filter({ hasText: /Changed in another tab|Draft save failed/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Display unit system' }).selectOption('mm-t-s');
  await page.waitForTimeout(1500);
  expect((await heads(page))[0].versionId).toBe(peerHead.versionId);
  expect(JSON.parse((await heads(page))[0].irJson).units.system_name).toBe('mm-N-s');
  expect((await downloadProject(page)).units.system_name).toBe('mm-t-s');
  await peer.close();
});

test('imports a large STL through the worker and keeps the resulting asset portable', async ({ page }) => {
  await createTemplate(page, 'Empty Project');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import', exact: true });
  const count = 25_000;
  const bytes = Buffer.alloc(84 + count * 50); bytes.writeUInt32LE(count, 80);
  for (let i = 0; i < count; i++) {
    const x = i % 256; const y = Math.floor(i / 256);
    const values = [0, 0, 1, x, y, 0, x + 1, y, 0, x, y + 1, 0];
    values.forEach((value, index) => bytes.writeFloatLE(value, 84 + i * 50 + index * 4));
  }
  const workerStarted = page.waitForEvent('worker');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /Drop file or click to browse/ }).click();
  await (await chooser).setFiles({ name: 'large-grid.stl', mimeType: 'model/stl', buffer: bytes });
  await workerStarted;
  await expect(dialog.getByRole('status').filter({ hasText: /Imported STL/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const project = await downloadProject(page);
  expect(project.geometry.bodies).toHaveLength(1);
  expect(project.assets[0].triangle_count).toBe(count);
  expect(Buffer.from(project.assets[0].data, 'base64')).toEqual(bytes);
});
