import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const fixture = resolve('tests/fixtures/thermal-benchmark');

test('shows case conditions and an actual thermal mesh result with its legend', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('fem-modeler-lang', 'en'); });
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('dialog', { name: 'FEM Modeler' }).getByRole('button', { name: /Open Existing/ }).click();
  await (await chooser).setFiles(resolve(fixture, 'project.json'));
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await page.getByRole('button', { name: /Geometry/ }).boundingBox())!.width).toBeGreaterThan(180);
  await page.getByRole('checkbox', { name: 'Conditions', exact: true }).check();
  await expect(page.getByText('Only participating conditions are shown.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Results/ }).click();
  const resultChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import result CSV / manifest / mesh JSON' }).click();
  await (await resultChooser).setFiles(resolve(fixture, 'result_package.json'));
  await expect(page.getByText('DOLFINx · complete', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).first().click();
  await expect(page.getByText('Matches current input', { exact: true })).toBeVisible();
  await expect(page.getByText('temperature [K]', { exact: true })).toBeVisible();
  await expect(page.getByText('Gray: missing value.', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('thermal-contour.png') });
  await page.getByRole('button', { name: 'Close result', exact: true }).click();
  await expect(page.getByText('Matches current input', { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
