import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { createProjectBundle, parseProjectBundle } from '@/export/project/bundle';
import { importSTL } from '@/geometry/import/stl-loader';

const TRIANGLE_STL = `solid triangle
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid triangle`;

describe('portable project bundle', () => {
  it('round-trips ProjectIR and externalized STL bytes with integrity metadata', async () => {
    const imported = importSTL(new TextEncoder().encode(TRIANGLE_STL).buffer, 'triangle.stl');
    expect(imported.success).toBe(true);
    const project = createDefaultProject();
    project.meta.project_name = 'portable';
    project.geometry.bodies.push(imported.body!);
    project.geometry.faces.push(...imported.faces!);
    project.assets.push(imported.asset!);

    const blob = await createProjectBundle(project);
    const result = await parseProjectBundle(await blob.arrayBuffer());

    expect(result.success).toBe(true);
    expect(result.data?.meta.project_name).toBe('portable');
    expect(result.data?.assets[0].data).toBe(imported.asset?.data);
    expect(result.data?.assets[0].content_hash).toBe(imported.asset?.content_hash);
  });

  it('rejects asset data that no longer matches the manifest hash', async () => {
    const imported = importSTL(new TextEncoder().encode(TRIANGLE_STL).buffer, 'triangle.stl');
    const project = createDefaultProject();
    project.geometry.bodies.push(imported.body!);
    project.geometry.faces.push(...imported.faces!);
    project.assets.push(imported.asset!);
    const source = await createProjectBundle(project);
    const zip = await JSZip.loadAsync(await source.arrayBuffer());
    const assetPath = Object.keys(zip.files).find((path) => path.startsWith('assets/') && !zip.files[path].dir)!;
    zip.file(assetPath, new Uint8Array(project.assets[0].byte_length));
    const tampered = await zip.generateAsync({ type: 'arraybuffer' });

    const result = await parseProjectBundle(tampered);

    expect(result.success).toBe(false);
    expect(result.error).toContain('integrity verification');
  });

  it('rejects a modified ProjectIR even when asset bytes are unchanged', async () => {
    const project = createDefaultProject();
    const source = await createProjectBundle(project);
    const zip = await JSZip.loadAsync(await source.arrayBuffer());
    const raw = JSON.parse(await zip.file('project.fem.json')!.async('text')) as Record<string, unknown>;
    (raw.meta as Record<string, unknown>).project_name = 'tampered project';
    zip.file('project.fem.json', JSON.stringify(raw));

    const result = await parseProjectBundle(await zip.generateAsync({ type: 'arraybuffer' }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('project failed SHA-256');
  });

  it('rejects undeclared archive entries', async () => {
    const source = await createProjectBundle(createDefaultProject());
    const zip = await JSZip.loadAsync(await source.arrayBuffer());
    zip.file('unexpected.txt', 'not declared');

    const result = await parseProjectBundle(await zip.generateAsync({ type: 'arraybuffer' }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('undeclared file');
  });
});
