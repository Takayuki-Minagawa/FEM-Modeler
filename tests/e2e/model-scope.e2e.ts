import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import type { ProjectIR } from '../../src/core/ir/types';

async function start(page: Page, template = 'Empty Project') {
  await page.addInitScript(() => localStorage.setItem('fem-modeler-lang', 'en'));
  await page.goto('./');
  const dialog = page.getByRole('dialog', { name: 'FEM Modeler' });
  if (template === 'Empty Project' && process.env.FEM_REVIEW_SCREENSHOT_DIR) {
    await page.screenshot({ path: resolve(process.env.FEM_REVIEW_SCREENSHOT_DIR, 'model-start.png') });
  }
  await expect(dialog.getByRole('button', { name: /Heat Transfer|Channel Flow|Open Heat generation/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: new RegExp(`^${template}`) }).click();
  await expect(dialog).toBeHidden();
}
async function save(page: Page): Promise<ProjectIR> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8')) as ProjectIR;
}
async function load(page: Page, name: string, bytes: Buffer) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: name.endsWith('.zip') ? 'application/zip' : 'application/json', buffer: bytes });
  await expect(page.getByRole('banner').getByRole('status')).toContainText(`${name}: Success`);
  await page.getByRole('banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
}
async function expectModelOnlyNavigation(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Model tree' });
  await expect(navigation.getByRole('button')).toHaveCount(6);
  for (const name of ['Geometry', 'Named Selections', 'Materials', 'Sections', 'Model handoff', 'Model checks']) {
    await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: /^(Analysis Cases|Boundary Conditions|Loads|Mesh Controls|Solver Targets|Results|Close result)$/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Physics advisor' })).toHaveCount(0);
}

for (const template of ['Empty Project', '2D Frame', '2D Truss', 'Plate', 'Pipe', 'L-Bracket']) {
  test(`${template} starts with modeling data and no analysis assumptions`, async ({ page }) => {
    await start(page, template);
    await expectModelOnlyNavigation(page);
    const ir = await save(page);
    expect(ir.geometry.bodies.length).toBe(template === 'Empty Project' ? 0 : 1);
    expect(ir.materials).toEqual([]); expect(ir.sections).toEqual([]);
    expect(ir.material_assignments).toEqual([]); expect(ir.section_assignments).toEqual([]);
    expect(ir.analysis_cases).toEqual([]); expect(ir.boundary_conditions).toEqual([]);
    expect(ir.loads).toEqual([]); expect(ir.results).toEqual([]); expect(ir.initial_conditions).toEqual([]);
    expect(Object.values(ir.solver_targets).every((target) => !target.enabled)).toBe(true);
    expect(ir.named_selections.every((group) => group.usages.every((usage) => ['material_assignment', 'section_assignment', 'export_tag'].includes(usage)))).toBe(true);
  });
}

test('model checks need geometry and sound references, without requiring analysis data', async ({ page }) => {
  await start(page);
  await page.getByRole('navigation', { name: 'Model tree' }).getByRole('button', { name: 'Model checks', exact: true }).click();
  await expect(page.getByText('Model checks have not been run', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check model', exact: true }).click();
  const empty = await save(page);
  expect(empty.validation.items.some((item) => item.code === 'MODEL_EMPTY')).toBe(true);
  await page.getByRole('button', { name: 'Open target: geometry', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Model tree' }).getByRole('button', { name: 'Geometry', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Create Shape', exact: true }).click();
  await page.getByRole('navigation', { name: 'Model tree' }).getByRole('button', { name: 'Model checks', exact: true }).click();
  await page.getByRole('button', { name: 'Check model', exact: true }).click();
  await expect(page.getByText('Current model checked', { exact: true })).toBeVisible();
  await expect(page.getByText('No model consistency issues were found.', { exact: true })).toBeVisible();
  const valid = await save(page);
  expect(valid.validation.items).toEqual([]);
  expect(valid.analysis_cases).toEqual([]); expect(valid.materials).toEqual([]);
});

test('material and section assignments survive JSON and Bundle model handoff', async ({ page }) => {
  await start(page, '2D Frame');
  const frame = await save(page);
  const group = frame.named_selections.find((selection) => selection.entity_type === 'edge')!;
  await page.getByRole('button', { name: /^Materials/ }).click();
  await page.getByRole('button', { name: 'Add Material', exact: true }).click();
  await page.getByLabel('Material Name', { exact: true }).fill('Member steel');
  await page.getByLabel('Density (optional)', { exact: true }).fill('7850');
  await page.getByLabel('Density (optional)', { exact: true }).blur();
  const material = (await save(page)).materials[0];
  await page.getByRole('button', { name: `Assign To: ${material.name} (${material.id})`, exact: true }).click();
  await page.getByRole('button', { name: `Assign ${material.name} to ${group.display_name ?? group.name} (${group.id})`, exact: true }).click();
  await page.getByRole('button', { name: /^Sections/ }).click();
  await page.getByRole('button', { name: 'Add Section', exact: true }).click();
  await page.getByLabel('Section Name', { exact: true }).fill('Rectangular member');
  await page.getByLabel('Width', { exact: true }).fill('0.3');
  await page.getByLabel('Width', { exact: true }).blur();
  await page.getByLabel('Height', { exact: true }).fill('0.6');
  await page.getByLabel('Height', { exact: true }).blur();
  const section = (await save(page)).sections[0];
  await page.getByRole('button', { name: `Assign To: ${section.name} (${section.id})`, exact: true }).click();
  await page.getByRole('button', { name: `Assign ${section.name} to ${group.display_name ?? group.name} (${group.id})`, exact: true }).click();
  const composed = await save(page);
  expect(composed.material_assignments).toContainEqual(expect.objectContaining({ material_id: material.id, target_named_selection_id: group.id }));
  expect(composed.section_assignments).toContainEqual(expect.objectContaining({ section_id: section.id, target_named_selection_id: group.id }));
  expect(composed.sections[0].dimensions).toMatchObject({ width: 0.3, height: 0.6 });
  await page.getByRole('button', { name: /^Model handoff/ }).click();
  await expect(page.getByRole('button', { name: /^(STEP Export|IGES Export|JSON · Save model|Bundle Save)/ })).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Material assignments', exact: true }).check();
  if (process.env.FEM_REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.FEM_REVIEW_SCREENSHOT_DIR, 'model-handoff.png') });
  const jsonPending = page.waitForEvent('download');
  await page.getByRole('button', { name: /^JSON · Save model/ }).click();
  const json = await readFile((await (await jsonPending).path())!);
  await load(page, 'composition.fem.json', json);
  expect((await save(page)).section_assignments).toEqual(composed.section_assignments);
  await page.getByRole('button', { name: /^Model handoff/ }).click();
  const bundlePending = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Bundle Save/ }).click();
  const bundle = await readFile((await (await bundlePending).path())!);
  const files = unzipSync(bundle);
  const bundled = JSON.parse(strFromU8(files['project.fem.json'])) as ProjectIR;
  expect(bundled.geometry).toEqual(composed.geometry);
  expect(bundled.material_assignments).toEqual(composed.material_assignments);
  await load(page, 'composition.fem.zip', bundle);
  const restored = await save(page);
  for (const key of ['geometry', 'materials', 'sections', 'named_selections', 'material_assignments', 'section_assignments'] as const) expect(restored[key]).toEqual(composed[key]);
});

test('an older analysis project preserves geometry and stored data without exposing analysis controls', async ({ page }) => {
  await start(page);
  const legacy = JSON.parse(await readFile('tests/fixtures/thermal-benchmark/project.json', 'utf8')) as ProjectIR;
  legacy.ui_state.active_panel = 'results';
  legacy.ui_state.last_opened_tabs = ['analysis_cases', 'results'];
  expect(legacy.analysis_cases.length).toBeGreaterThan(0);
  await load(page, 'legacy.fem.json', Buffer.from(JSON.stringify(legacy)));
  await expectModelOnlyNavigation(page);
  await expect(page.locator('canvas')).toBeVisible();
  const restored = await save(page);
  expect(restored.geometry).toEqual(legacy.geometry);
  expect(restored.analysis_cases).toEqual(legacy.analysis_cases);
  expect(restored.loads).toEqual(legacy.loads);
  expect(restored.boundary_conditions).toEqual(legacy.boundary_conditions);
  await page.getByRole('button', { name: /^Model handoff/ }).click();
  await expect(page.getByRole('button', { name: /OpenSeesPy|DOLFINx|OpenFOAM/ })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Model tree' }).getByRole('button', { name: 'Model checks', exact: true }).click();
  await page.getByRole('button', { name: 'Check model', exact: true }).click();
  const checked = await save(page);
  expect(checked.validation.items.every((item) => item.code.startsWith('MODEL_'))).toBe(true);
  await expectModelOnlyNavigation(page);
});

for (const width of [600, 1024, 1280, 1440]) {
  test(`keyboard model editing and save/reload remain reachable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 600 ? 655 : 820 });
    await start(page, '2D Frame');
    const navigation = page.getByRole('navigation', { name: 'Model tree' });
    const materials = navigation.getByRole('button', { name: 'Materials', exact: true });
    await materials.focus(); await page.keyboard.press('Enter');
    const add = page.getByRole('button', { name: 'Add Material', exact: true });
    await add.focus(); await page.keyboard.press('Space');
    await page.getByLabel('Material Name', { exact: true }).fill('Keyboard material');
    await page.getByLabel('Density (optional)', { exact: true }).fill('2700');
    await page.keyboard.press('Tab');
    if (width < 1200) await page.getByRole('button', { name: 'Close properties', exact: true }).click();
    const menu = page.locator('summary').filter({ hasText: 'More actions' });
    await menu.focus(); await page.keyboard.press('Enter');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save', exact: true }).focus(); await page.keyboard.press('Enter');
    const bytes = await readFile((await (await pending).path())!);
    const saved = JSON.parse(bytes.toString()) as ProjectIR;
    expect(saved.materials[0].name).toBe('Keyboard material');
    expect(saved.materials[0].parameter_set.density.value).toBe(2700);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Load', exact: true }).focus(); await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name: 'keyboard.fem.json', mimeType: 'application/json', buffer: bytes });
    await expect(page.getByRole('banner').getByRole('status')).toContainText('keyboard.fem.json: Success');
    await page.getByRole('banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
    await menu.focus(); await page.keyboard.press('Escape');
    await materials.click();
    await page.getByRole('button', { name: `Select Keyboard material (${saved.materials[0].id})`, exact: true }).click();
    await expect(page.getByLabel('Density (optional)', { exact: true })).toHaveValue('2700');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`model-keyboard-${width}.png`) });
  });
}
