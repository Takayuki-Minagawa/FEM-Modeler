import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { ProjectIR } from '../../src/core/ir/types';

// Public controls and downloaded documents are the only model inputs/observations.
// Browser storage is used only for the user's display-language preference.
async function start(page: Page, template = 'Empty Project') {
  await page.addInitScript(() => localStorage.setItem('fem-modeler-lang', 'en'));
  await page.goto('./');
  const dialog = page.getByRole('dialog', { name: 'FEM Modeler' });
  await dialog.getByRole('button', { name: new RegExp(`^${template}`) }).click();
  await expect(dialog).toBeHidden();
}
async function download(page: Page, button: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  return readFile((await (await pending).path())!, 'utf8');
}
async function save(page: Page): Promise<ProjectIR> { return JSON.parse(await download(page, 'Save')) as ProjectIR; }
async function load(page: Page, ir: ProjectIR) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await (await chooser).setFiles({ name: 'continuation.fem.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(ir)) });
  await expect(page.getByRole('dialog')).toBeHidden();
  const notice = page.getByRole('banner').getByRole('status');
  await expect(notice).toContainText('continuation.fem.json: Success');
  await page.getByRole('banner').getByRole('button', { name: 'Dismiss', exact: true }).click();
}
async function panel(page: Page, name: string) { await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click(); }
test('F02: membership rules preview, persist across save/load and undo as one edit', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Create Shape', exact: true }).click();
  const created = await save(page); const body = created.geometry.bodies[0]; const vertex = created.geometry.vertices[0];
  await panel(page, 'Named Selections');
  const form = page.getByRole('region', { name: 'New Named Selection', exact: true });
  await form.getByRole('button', { name: 'vertex', exact: true }).click();
  await form.getByRole('option', { name: `${body.name} / ${vertex.name} / ${vertex.id}`, exact: true }).click();
  await form.getByLabel('Selection name', { exact: true }).fill('Positive X vertices');
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  const before = await save(page); const selection = before.named_selections[0];
  await page.getByRole('button', { name: `Edit Positive X vertices (${selection.id})`, exact: true }).click();
  const editor = page.getByRole('region', { name: 'Edit membership', exact: true });
  await editor.getByLabel('Set operation', { exact: true }).selectOption('replace');
  await editor.getByLabel('Candidate rule', { exact: true }).selectOption('coordinate_range');
  await editor.getByLabel('Minimum (m)', { exact: true }).fill('0');
  await editor.getByRole('button', { name: 'Preview membership', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('1 → 4 members');
  expect((await save(page)).named_selections).toEqual(before.named_selections);
  await editor.getByRole('button', { name: 'Apply membership', exact: true }).click();
  const after = await save(page);
  expect(after.named_selections[0].member_refs).toEqual(created.geometry.vertices.filter((item) => item.position[0] >= 0).map((item) => item.id));
  expect(after.named_selections[0].query_definition).toMatchObject({ operation: 'replace', coordinate_frame: 'world', length_unit: 'm', predicate: { kind: 'coordinate_range', axis: 0, min: 0, max: null } });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await save(page)).named_selections).toEqual(before.named_selections);
  await load(page, after); await panel(page, 'Named Selections');
  await page.getByRole('button', { name: `Edit Positive X vertices (${selection.id})`, exact: true }).click();
  await page.getByRole('button', { name: 'Preview saved rule', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Edit membership', exact: true })).toContainText('4 → 4 members');
});

test('F03: frame dimension edits preserve IDs while floor changes invalidate member groups and undo restores them', async ({ page }) => {
  await start(page, '2D Frame');
  const before = await save(page); const body = before.geometry.bodies[0];
  await page.getByRole('button', { name: `Select ${body.name} (${body.id})`, exact: true }).click();
  await page.getByLabel('Dimension spanX', { exact: true }).fill(String(Number(body.metadata.spanX) * 2));
  await page.getByRole('button', { name: 'Apply dimensions', exact: true }).click();
  const dimensional = await save(page);
  expect(dimensional.geometry.vertices.map((item) => item.id)).toEqual(before.geometry.vertices.map((item) => item.id));
  expect(dimensional.named_selections).toEqual(before.named_selections);
  await page.getByLabel('Dimension floors', { exact: true }).fill(String(Number(body.metadata.floors) + 1));
  await expect(page.getByRole('note')).toContainText('become stale');
  await page.getByRole('button', { name: 'Apply dimensions', exact: true }).click();
  const topology = await save(page);
  expect(topology.named_selections.some((item) => item.status === 'stale' && item.member_refs.length === 0)).toBe(true);
  expect(topology.material_assignments).toEqual(before.material_assignments);
  expect(topology.geometry.bodies[0].transform).toEqual(before.geometry.bodies[0].transform);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await save(page);
  expect(undone.geometry).toEqual(dimensional.geometry); expect(undone.named_selections).toEqual(dimensional.named_selections);
});

test('F04: duplicated material assigns to two domains in one reviewed batch and Undo restores assignments', async ({ page }) => {
  await start(page, '2D Frame'); const initial = await save(page); const body = initial.geometry.bodies[0];
  await page.getByRole('button', { name: `Select ${body.name} (${body.id})`, exact: true }).click();
  await page.getByRole('button', { name: 'Create Pattern Copies', exact: true }).click();
  const patterned = await save(page); const copyBody = patterned.geometry.bodies.find((item) => item.id !== body.id)!;
  await panel(page, 'Named Selections');
  const creation = page.getByRole('region', { name: 'New Named Selection', exact: true });
  await creation.getByRole('button', { name: 'body', exact: true }).click();
  await creation.getByRole('option', { name: `${copyBody.name} / ${copyBody.id}`, exact: true }).click();
  await creation.getByLabel('Selection name', { exact: true }).fill('Copied domain');
  await creation.getByRole('button', { name: 'Create', exact: true }).click();
  await panel(page, 'Materials');
  await page.getByRole('button', { name: 'Add Material', exact: true }).click();
  const material = (await save(page)).materials[0];
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  const before = await save(page); const copyMaterial = before.materials.find((item) => item.id !== material.id)!;
  await page.getByRole('button', { name: `Assign To: ${copyMaterial.name} (${copyMaterial.id})`, exact: true }).click();
  await page.getByText('Assign to multiple targets', { exact: true }).click();
  const batch = page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Assign to multiple targets$/ }) });
  const bodyGroup = before.named_selections.find((item) => item.entity_type === 'body' && item.member_refs.includes(body.id))!;
  const copyGroup = before.named_selections.find((item) => item.entity_type === 'body' && item.member_refs.includes(copyBody.id))!;
  for (const target of [bodyGroup, copyGroup]) await batch.getByRole('checkbox', { name: `${target.display_name ?? target.name} (${target.id})`, exact: true }).check();
  await batch.getByRole('button', { name: 'Preview changes', exact: true }).click();
  expect((await save(page)).material_assignments).toEqual(before.material_assignments);
  await batch.getByRole('button', { name: 'Apply batch', exact: true }).click();
  const assigned = await save(page); expect(assigned.material_assignments).toHaveLength(2);
  expect(assigned.material_assignments.every((item) => item.material_id === copyMaterial.id)).toBe(true);
  await batch.getByRole('button', { name: 'Undo this batch', exact: true }).click();
  expect((await save(page)).material_assignments).toEqual(before.material_assignments);
});
