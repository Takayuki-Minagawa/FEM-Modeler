import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import { generateShape } from '@/geometry/primitives/generators';
import { exportOpenSeesPy } from '@/export/openseespy/exporter';
import { exportDOLFINx } from '@/export/dolfinx/exporter';
import { exportOpenFOAM } from '@/export/openfoam/exporter';

describe('body transform export support', () => {
  it('applies body transforms to OpenSeesPy node coordinates', () => {
    const project = createDefaultProject();
    const shape = generateShape(
      { shapeType: 'frame2d', spanX: 4, spanY: 4, columns: 2, floors: 1 },
      'Frame',
    );
    shape.body.transform.position = [10, 5, 0];
    shape.body.transform.rotation = [0, 0, 90];

    project.geometry.bodies.push(shape.body);
    project.geometry.vertices.push(...shape.vertices);

    const result = exportOpenSeesPy(project);
    const rows = result.nodesCsv.split('\n');

    expect(rows[1]).toBe('1,10,5,0');
    expect(rows[2]).toBe('2,10,9,0');
  });

  it('emits Gmsh transform commands for transformed solid bodies', () => {
    const project = createDefaultProject();
    const shape = generateShape(
      { shapeType: 'box', width: 2, height: 2, depth: 2 },
      'Solid',
    );
    shape.body.transform.position = [1, 2, 3];
    shape.body.transform.rotation = [0, 0, 45];
    shape.body.transform.scale = [2, 1, 1];

    project.geometry.bodies.push(shape.body);
    project.geometry.faces.push(...shape.faces);
    project.materials.push({
      id: 'mat_1',
      name: 'Steel',
      class: 'elastic',
      physical_model: 'isotropic_linear',
      parameter_set: {
        ...createEmptyParameterSet(),
        young_modulus: { value: 2.1e11, status: 'confirmed' },
        poisson_ratio: { value: 0.3, status: 'confirmed' },
      },
      source: 'test',
      notes: '',
    });

    const result = exportDOLFINx(project);

    expect(result.geoFile).toContain('Dilate {{0, 0, 0}, {2, 1, 1}} { Volume{1}; }');
    expect(result.geoFile).toContain('Rotate {{0, 0, 1}, {0, 0, 0},');
    expect(result.geoFile).toContain('Translate {1, 2, 3} { Volume{1}; }');
  });

  it('emits Gmsh rotations in Z-Y-X order to match THREE.js Euler XYZ', () => {
    const project = createDefaultProject();
    const shape = generateShape(
      { shapeType: 'box', width: 1, height: 1, depth: 1 },
      'MultiAxis',
    );
    shape.body.transform.rotation = [30, 45, 60];

    project.geometry.bodies.push(shape.body);
    project.geometry.faces.push(...shape.faces);
    project.materials.push({
      id: 'mat_1',
      name: 'Steel',
      class: 'elastic',
      physical_model: 'isotropic_linear',
      parameter_set: {
        ...createEmptyParameterSet(),
        young_modulus: { value: 2.1e11, status: 'confirmed' },
        poisson_ratio: { value: 0.3, status: 'confirmed' },
      },
      source: 'test',
      notes: '',
    });

    const result = exportDOLFINx(project);
    const geo = result.geoFile!;
    const rotateZ = geo.indexOf('Rotate {{0, 0, 1}');
    const rotateY = geo.indexOf('Rotate {{0, 1, 0}');
    const rotateX = geo.indexOf('Rotate {{1, 0, 0}');

    expect(rotateZ).toBeGreaterThan(-1);
    expect(rotateY).toBeGreaterThan(-1);
    expect(rotateX).toBeGreaterThan(-1);
    // Z must appear before Y, Y before X (reverse order for extrinsic → intrinsic match)
    expect(rotateZ).toBeLessThan(rotateY);
    expect(rotateY).toBeLessThan(rotateX);
  });

  it('writes transformed blockMesh vertices for channel bodies', () => {
    const project = createDefaultProject();
    const shape = generateShape(
      { shapeType: 'channel', length: 6, height: 1, depth: 1 },
      'Channel',
    );
    shape.body.transform.position = [1, 0, 0];

    project.geometry.bodies.push(shape.body);

    const result = exportOpenFOAM(project);
    const blockMesh = result.files['system/blockMeshDict'];

    expect(blockMesh).toContain('(-2 -0.5 -0.5)');
    expect(blockMesh).toContain('(4 0.5 0.5)');
  });
});
