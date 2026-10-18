import { describe, expect, it } from 'vitest';
import { csvCoordinatesForResult, importMappedCsv, previewResultCsv } from '@/results/csv-mapping';
import { parseResultText, verifyResultImport } from '@/results/importer';
import { parseProjectFile } from '@/export/project/load';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';

const text = 'sample,x,y,T,force,note\n10,10,20,25,2,A\n20,30,40,,3,B\n30,50,60,75,4,C';
const mapping = () => {
  const preview = previewResultCsv(text, 'DOLFINx');
  return { ...preview.mapping, entityColumn: 0, location: 'node' as const, coordinates: { x: 1, y: 2, z: null, unit: 'mm' },
    missingPolicy: 'exclude_rows' as const,
    fields: preview.mapping.fields.map((field) => ({ ...field, enabled: field.column === 3 || field.column === 4, name: field.column === 3 ? 'temperature' : field.name, unit: field.column === 3 ? '°C' : 'kN' })),
  };
};

describe('CSV mapping and preview', () => {
  it('previews the exact excluded source rows and imports aligned coordinates and fields in SI', () => {
    const settings = mapping();
    const preview = previewResultCsv(text, 'DOLFINx', settings);
    expect(preview).toMatchObject({ sourceRows: 3, importedRows: 2, excludedRows: 1, importedFields: 2, ignoredColumns: ['note'] });
    expect(preview.diagnostics).toEqual([expect.objectContaining({ code: 'excluded_rows', column: 'T', source_rows: [3], reason: 'missing_value' })]);
    const result = importMappedCsv(text, 'mapped.csv', 'case', 'DOLFINx', settings);
    expect(result.fields.map((field) => [field.name, field.unit, field.entity_ids, field.values])).toEqual([
      ['temperature', 'K', ['10', '30'], [298.15, 348.15]], ['force', 'N', ['10', '30'], [2000, 4000]],
    ]);
    expect(result.metadata.csv_coordinates).toEqual({ unit: 'm', location: 'node', entity_ids: ['10', '30'], positions: [[0.01, 0.02, 0], [0.05, 0.06, 0]] });
    expect(result.metadata).not.toHaveProperty('input_fingerprint');
    expect(result.mesh).toBeUndefined();
    const verified = verifyResultImport(result, 'case', 'DOLFINx').result!;
    expect(verified.metadata.provenance_verified).toBe(false);
    expect(verified.metadata.import_outcome).toBe('partial');
  });
  it('rejects missing values when requested, while column exclusion preserves the other columns and original rows', () => {
    const settings = mapping();
    expect(previewResultCsv(text, 'DOLFINx', { ...settings, missingPolicy: 'reject' }).error).toContain('invalid values on 1');
    expect(() => importMappedCsv(text, 'x.csv', 'case', 'DOLFINx', { ...settings, missingPolicy: 'reject' })).toThrow('invalid values');
    const result = importMappedCsv(text, 'x.csv', 'case', 'DOLFINx', { ...settings, missingPolicy: 'exclude_columns' });
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].entity_ids).toEqual(['10', '20', '30']);
    expect(result.metadata.skipped_columns).toEqual(['T']);
  });
  it('retains unknown unit labels without pretending they were converted, and rejects nonlength coordinate units', () => {
    const settings = mapping(); settings.fields[4].unit = 'instrument units';
    const result = importMappedCsv(text, 'x.csv', 'case', 'DOLFINx', settings);
    expect(result.fields[1]).toMatchObject({ unit: 'instrument units', values: [2, 4] });
    expect(result.metadata.import_diagnostics).toContainEqual(expect.objectContaining({ code: 'unconverted_unit' }));
    expect(previewResultCsv(text, 'DOLFINx', { ...settings, coordinates: { ...settings.coordinates, unit: 'Pa' } }).error).toContain('length unit');
  });
  it('handles source line numbering, escaped quotes and BOM including a provenance line', () => {
    const source = '\uFEFF# FEM_MODELER_PROVENANCE {"run_id":"external"}\r\nnode_id,u [mm],v\r\n1,1,"bad\r\nvalue"\r\n2,2,0';
    const preview = previewResultCsv(source, 'OpenSeesPy');
    expect(preview.sample.map((row) => row.sourceLine)).toEqual([3, 5]);
    expect(preview.diagnostics[0]).toMatchObject({ source_rows: [3] });
    const parsed = parseResultText(source, 'source.csv', 'case', 'OpenSeesPy');
    expect(parsed.result!.fields[0]).toMatchObject({ unit: 'm', values: [0.001, 0.002] });
    expect(parsed.result!.metadata.run_id).toBe('external');
  });
  it('previews invalid IDs so users can select another identifier column without silently renumbering solver IDs', () => {
    const source = 'id,actual,value\nsame,1,5\nsame,2,6';
    const preview = previewResultCsv(source, 'OpenSeesPy');
    expect(preview.error).toContain('IDs must be unique');
    const changed = { ...preview.mapping, entityColumn: 1, fields: preview.mapping.fields.map((field) => ({ ...field, enabled: field.column === 2 })) };
    expect(previewResultCsv(source, 'OpenSeesPy', changed).error).toBeUndefined();
    expect(importMappedCsv(source, 'x.csv', 'case', 'OpenSeesPy', changed).fields[0].entity_ids).toEqual(['1', '2']);
  });
  it('rejects duplicate field names, invalid coordinate roles, no remaining rows and conversion overflow', () => {
    const settings = mapping();
    const duplicate = structuredClone(settings); duplicate.fields[4].name = 'temperature';
    expect(previewResultCsv(text, 'DOLFINx', duplicate).error).toContain('unique');
    expect(previewResultCsv(text, 'DOLFINx', { ...settings, coordinates: { ...settings.coordinates, x: 0 } }).error).toContain('distinct');
    expect(previewResultCsv(text, 'DOLFINx', { ...settings, coordinates: { ...settings.coordinates, x: null } }).error).toContain('both X and Y');
    const empty = 'node,u\n1,NaN'; const emptySettings = previewResultCsv(empty, 'OpenSeesPy').mapping;
    expect(previewResultCsv(empty, 'OpenSeesPy', { ...emptySettings, missingPolicy: 'exclude_rows' }).error).toContain('No data rows remain');
    expect(parseResultText('node,u [GPa]\n1,1e308', 'x.csv', 'case', 'OpenSeesPy').error).toContain('overflow');
  });
  it('uses decimal/scientific syntax consistently with numeric inputs, and distinguishes missing and nonfinite values', () => {
    const source = 'node,value\n1,0x10\n2,0b11\n3,Infinity\n4,1e999\n5,\n6,1.5e-2';
    const settings = previewResultCsv(source, 'OpenSeesPy').mapping;
    const preview = previewResultCsv(source, 'OpenSeesPy', { ...settings, missingPolicy: 'exclude_rows' });
    expect(preview.diagnostics.map((item) => [item.reason, item.source_rows])).toEqual([['missing_value', [6]], ['nonnumeric_value', [2, 3]], ['nonfinite_value', [4, 5]]]);
    expect(importMappedCsv(source, 'x.csv', 'case', 'OpenSeesPy', { ...settings, missingPolicy: 'exclude_rows' }).fields[0].values).toEqual([0.015]);
  });
  it('validates saved coordinate correspondence before comparison and bounds preview samples without truncating imported data', () => {
    const result = importMappedCsv(text, 'x.csv', 'case', 'DOLFINx', mapping());
    expect(csvCoordinatesForResult(result)?.entity_ids).toEqual(['10', '30']);
    const malformed = structuredClone(result);
    (malformed.metadata.csv_coordinates as { entity_ids: string[] }).entity_ids = ['10', '10'];
    expect(csvCoordinatesForResult(malformed)).toBeUndefined();
    malformed.metadata.csv_coordinates = { unit: 'm', location: 'node', entity_ids: ['10'], positions: [[0, Infinity, 0]] };
    expect(csvCoordinatesForResult(malformed)).toBeUndefined();
    const identifier = 'n'.repeat(300);
    const source = `node,value\n${identifier},1`;
    expect(previewResultCsv(source, 'OpenSeesPy').sample[0].values[0]).toHaveLength(161);
    expect(importMappedCsv(source, 'long.csv', 'case', 'OpenSeesPy').fields[0].entity_ids).toEqual([identifier]);
  });
  it('persists mapping and exclusion diagnostics through project save and reload', () => {
    useAppStore.getState().createProject('mapping', 'thermal'); applyTemplate('thermal', 'en');
    const project = structuredClone(useAppStore.getState().ir);
    const id = project.analysis_cases[0].id;
    project.results.push(verifyResultImport(importMappedCsv(text, 'saved.csv', id, 'DOLFINx', mapping()), id, 'DOLFINx').result!);
    const reloaded = parseProjectFile(JSON.stringify(project));
    expect(reloaded.success).toBe(true);
    expect(reloaded.data!.results[0].metadata.csv_mapping).toEqual(mapping());
    expect(reloaded.data!.results[0].metadata.csv_coordinates).toEqual(project.results[0].metadata.csv_coordinates);
  });
});
