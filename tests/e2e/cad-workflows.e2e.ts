import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProjectIR } from '../../src/core/ir/types';

async function startEmptyProject(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('fem-modeler-lang', 'en'); });
  await page.goto('./');
  await page.getByRole('dialog', { name: 'FEM Modeler' }).getByRole('button', { name: /Empty Project/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
async function importFile(page: Page, fileName: string) {
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import', exact: true });
  // CAD files declare their own units; this deliberately different STL unit
  // must never change the CAD dimensions.
  await dialog.getByRole('combobox').selectOption('ft');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: /Drop file or click to browse/ }).click();
  await (await chooser).setFiles(resolve('tests/fixtures/cad', fileName));
  return dialog;
}
async function saveProject(page: Page): Promise<ProjectIR> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await pending;
  return JSON.parse(await readFile((await saved.path())!, 'utf8')) as ProjectIR;
}

for (const format of ['step', 'iges'] as const) {
  test(`imports inch ${format.toUpperCase()}, shows an SI preview and preserves the exact source through CAD export`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await startEmptyProject(page);
    const sourceName = `cylinder_inch.${format}`;
    const dialog = await importFile(page, sourceName);
    await expect(dialog.getByRole('status')).toContainText('Imported', { timeout: 120_000 });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const project = await saveProject(page);
    expect(project.geometry.bodies).toHaveLength(1);
    expect(project.geometry.bodies[0].metadata).toMatchObject({ shapeType: 'imported_cad', importFormat: format, sourceUnit: 'm', scaleToMeters: 1 });
    const asset = project.assets[0];
    expect(asset.triangle_count).toBeGreaterThan(4);
    expect(asset.bounds.max[2] - asset.bounds.min[2]).toBeCloseTo(0.03, 6);
    expect(asset.bounds.max[0] - asset.bounds.min[0]).toBeCloseTo(0.02, 4);
    expect(Buffer.from(asset.cad_source!.data, 'base64')).toEqual(await readFile(resolve('tests/fixtures/cad', sourceName)));
    await expect(page.locator('canvas')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${format}-import-preview.png`) });
    const projectChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Load', exact: true }).click();
    await (await projectChooser).setFiles({ name: 'cad-roundtrip.fem.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await expect(page.getByText(project.geometry.bodies[0].name, { exact: true }).first()).toBeVisible();
    const restored = await saveProject(page);
    expect(restored.assets[0].cad_source).toEqual(asset.cad_source);
    await page.screenshot({ path: testInfo.outputPath(`${format}-restored-preview.png`) });
    await page.getByRole('button', { name: /Solver Targets/ }).click();
    const pending = page.waitForEvent('download', { timeout: 120_000 });
    await page.getByRole('button', { name: new RegExp(`^${format.toUpperCase()} Export all bodies`) }).click();
    const output = await pending;
    expect(output.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
    await output.saveAs(testInfo.outputPath(`cylinder-roundtrip.${format}`));
    expect((await readFile((await output.path())!)).byteLength).toBeGreaterThan(100);
    await expect(page.getByRole('status').filter({ hasText: `${format.toUpperCase()}: Success` })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('reports malformed CAD without adding a body and permits another import', async ({ page }) => {
  test.setTimeout(180_000);
  await startEmptyProject(page);
  const dialog = await importFile(page, 'invalid.step');
  await expect(dialog.getByRole('status')).not.toContainText('Converting', { timeout: 120_000 });
  await expect(dialog.getByRole('status')).not.toContainText('Imported');
  await expect(dialog.getByRole('button', { name: 'Cancel import' })).toBeHidden();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await saveProject(page)).geometry.bodies).toHaveLength(0);
  const retry = await importFile(page, 'cylinder_mm.step');
  await expect(retry.getByRole('status')).toContainText('Imported', { timeout: 120_000 });
  await retry.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await saveProject(page)).geometry.bodies).toHaveLength(1);
});
