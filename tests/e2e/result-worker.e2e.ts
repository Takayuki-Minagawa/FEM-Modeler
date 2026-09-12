import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('parses a large CSV in a real module worker and stores verified fields', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('fem-modeler-lang', 'en'); });
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'FEM Modeler' }).getByRole('button', { name: /Open Existing/ }).click();
  await (await chooser).setFiles(resolve('tests/fixtures/thermal-benchmark/project.json'));
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: /Results/ }).click();
  const packet = JSON.parse(await readFile('tests/fixtures/thermal-benchmark/result_package.json', 'utf8'));
  const rowCount = 60_000;
  const csv = `# FEM_MODELER_PROVENANCE ${JSON.stringify(packet.manifest)}\nnode_id,temperature_K\n`
    + Array.from({ length: rowCount }, (_, index) => `${index + 1},300.123456789012345`).join('\n');
  expect(Buffer.byteLength(csv)).toBeGreaterThan(1024 * 1024);
  const workerStarted = page.waitForEvent('worker');
  const resultChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import result CSV / manifest / mesh JSON' }).click();
  await (await resultChooser).setFiles({ name: 'large-worker.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await workerStarted;
  await expect(page.getByText('DOLFINx · complete', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import result CSV / manifest / mesh JSON' })).toBeEnabled();
  await expect.poll(() => page.workers().length).toBe(0);
  const save = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await save;
  const project = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(project.results[0].metadata.provenance_verified).toBe(true);
  expect(project.results[0].fields[0].values).toHaveLength(rowCount);
  expect(errors).toEqual([]);
});
