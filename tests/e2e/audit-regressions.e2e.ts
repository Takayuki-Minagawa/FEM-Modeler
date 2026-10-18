import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ProjectIR } from '../../src/core/ir/types';

// These regressions use public UI controls and inspect real downloaded files.
// The only browser storage write sets the display language before startup.
async function start(page: Page, template: string) {
  await page.addInitScript(() => localStorage.setItem('fem-modeler-lang', 'en'));
  await page.goto('./');
  const dialog = page.getByRole('dialog', { name: 'FEM Modeler' });
  await dialog.getByRole('button', { name: new RegExp(`^${template}`) }).click();
  await expect(dialog).toBeHidden();
}

async function downloadText(page: Page, button: RegExp | string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: typeof button === 'string' }).click();
  const download = await pending;
  return readFile((await download.path())!, 'utf8');
}

async function save(page: Page): Promise<ProjectIR> {
  return JSON.parse(await downloadText(page, 'Save')) as ProjectIR;
}

test('B01/B02: precise transform survives a rename and pattern copies undo as one operation', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await start(page, 'Empty Project');
  await page.getByRole('button', { name: 'Create Shape', exact: true }).click();
  const created = await save(page);
  const body = created.geometry.bodies[0];
  await page.getByRole('button', { name: `Select ${body.name} (${body.id})`, exact: true }).click();
  await page.getByLabel('Position X', { exact: true }).fill('0.00001234');
  await page.getByLabel('Rotation (deg) Z', { exact: true }).fill('0.00001234567');
  await page.getByLabel('Scale X', { exact: true }).fill('1.234567890123');
  await page.getByRole('button', { name: 'Apply Edits', exact: true }).click();
  const transformed = await save(page);
  expect(transformed.geometry.bodies[0].transform.position[0]).toBe(0.00001234);
  await page.getByRole('combobox', { name: 'Display unit system' }).selectOption('mm-N-s');
  await page.getByLabel('Name', { exact: true }).fill('Precise box');
  await page.getByRole('button', { name: 'Apply Edits', exact: true }).click();
  const renamed = await save(page);
  expect(renamed.geometry.bodies[0].transform).toEqual(transformed.geometry.bodies[0].transform);
  await page.getByLabel('Copies', { exact: true }).fill('2');
  await page.getByLabel('Offset X', { exact: true }).fill('2500');
  await page.getByRole('button', { name: 'Create Pattern Copies', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Created 2 body copies.' })).toBeVisible();
  const copied = await save(page);
  expect(copied.geometry.bodies).toHaveLength(3);
  expect(copied.geometry.bodies.map((item) => item.transform.position[0])).toEqual([
    0.00001234, 2.50001234, 5.00001234,
  ]);
  expect(new Set(copied.geometry.faces.map((face) => face.id)).size).toBe(copied.geometry.faces.length);
  for (const face of copied.geometry.faces) expect(copied.geometry.bodies.some((item) => item.id === face.body_id)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await save(page)).geometry).toEqual(renamed.geometry);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await save(page)).geometry).toEqual(copied.geometry);
  expect(pageErrors).toEqual([]);
});

test('B05: Japanese pipe radii keep their geometric meaning', async ({ page }) => {
  await start(page, 'Empty Project');
  await page.getByRole('button', { name: 'Pipe', exact: true }).click();
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByLabel('外半径', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('内半径', { exact: true })).toHaveValue('0.8');
  await page.getByRole('button', { name: '形状を作成', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  expect((await save(page)).geometry.bodies[0].metadata).toMatchObject({ shapeType: 'pipe', outerRadius: 1, innerRadius: 0.8 });
});
