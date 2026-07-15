import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import {
  csvRow,
  escapeCsvCell,
  escapeMarkdownInline,
  escapeMarkdownTableCell,
  markdownTableRow,
  neutralizeSpreadsheetFormula,
  sanitizeArtifactName,
  serializeCsv,
  solverIdentifier,
  uniqueSolverIdentifier,
} from '@/export/shared/artifact-sanitization';
import { exportConditionsCsv } from '@/export/project/csv-export';
import { exportMarkdownSummary } from '@/export/project/markdown-summary';

function deterministicStrings(count: number): string[] {
  const alphabet = ['a', 'Z', '0', ' ', '\t', ',', '"', '\r', '\n', '=', '+', '-', '@', '\\', '|', '/', '<', '>'];
  let state = 0x1234abcd;
  return Array.from({ length: count }, (_, sampleIndex) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const length = 1 + (state % 20);
    let result = sampleIndex % 8 === 0 ? ['=', '+', '-', '@'][sampleIndex % 4] : '';
    for (let index = result.length; index < length; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      result += alphabet[state % alphabet.length];
    }
    return result;
  });
}

function parseCsv(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\r' && csv[index + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      index += 1;
    } else {
      field += character;
    }
  }

  record.push(field);
  records.push(record);
  return records;
}

function expectNoUnescapedMarkdownPipe(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '|') continue;
    let precedingBackslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
      precedingBackslashes += 1;
    }
    expect(precedingBackslashes % 2).toBe(1);
  }
}

describe('CSV artifact serialization', () => {
  it('quotes delimiters, quotes, and newlines according to RFC 4180', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hello"')).toBe('"say ""hello"""');
    expect(escapeCsvCell('line 1\r\nline 2')).toBe('"line 1\r\nline 2"');
    expect(serializeCsv([['a', 'b'], ['x,y', 'line\nbreak']]))
      .toBe('a,b\r\n"x,y","line\nbreak"');
  });

  it('neutralizes formula-like string cells after optional whitespace', () => {
    for (const value of ['=1+1', ' +SUM(A1:A2)', '\t-cmd', '\r\n@IMPORTXML("x")']) {
      expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);
      expect(parseCsv(csvRow([value]))[0]?.[0]).toBe(`'${value}`);
    }

    // A typed numeric value is data, not attacker-controlled formula text.
    expect(escapeCsvCell(-12.5)).toBe('-12.5');
    expect(escapeCsvCell('ordinary text')).toBe('ordinary text');
  });

  it('round-trips a deterministic corpus without changing record width', () => {
    for (const value of deterministicStrings(300)) {
      const expected = neutralizeSpreadsheetFormula(value);
      const parsed = parseCsv(csvRow(['sentinel', value, 'tail']));
      expect(parsed).toEqual([['sentinel', expected, 'tail']]);
    }
  });

  it('uses the safe serializer for exported project records', () => {
    const project = createDefaultProject();
    project.materials.push({
      id: 'mat_csv',
      name: ' =HYPERLINK("https://example.invalid"),Injected',
      class: 'elastic',
      physical_model: 'isotropic_linear',
      parameter_set: {
        ...createEmptyParameterSet(),
        young_modulus: { value: 210e9, status: 'confirmed' },
      },
      source: 'test',
      notes: '',
    });

    const parsed = parseCsv(exportConditionsCsv(project));
    const materialsMarker = parsed.findIndex((record) => record[0] === '## Materials');
    const materialRecord = parsed[materialsMarker + 2];

    expect(materialRecord).toHaveLength(8);
    expect(materialRecord?.[0]).toBe('\' =HYPERLINK("https://example.invalid"),Injected');
    expect(materialRecord?.[2]).toBe('210000000000');
  });
});

describe('Markdown artifact serialization', () => {
  it('escapes table pipes, backslashes, physical newlines, and raw HTML', () => {
    expect(escapeMarkdownTableCell('a\\b|c\r\nd<script>'))
      .toBe('a\\\\b\\|c<br>d&lt;script&gt;');
    expect(markdownTableRow(['a|b', 'line\n2']))
      .toBe('| a\\|b | line<br>2 |');
  });

  it('keeps every generated pipe inside its original table cell', () => {
    for (const value of deterministicStrings(300)) {
      const escaped = escapeMarkdownTableCell(value);
      expectNoUnescapedMarkdownPipe(escaped);
      expect(escaped).not.toMatch(/[\r\n]/);
    }
  });

  it('prevents headings and table values from injecting Markdown blocks', () => {
    expect(escapeMarkdownInline('Project\n## injected')).toBe('Project \\#\\# injected');

    const project = createDefaultProject();
    project.meta.project_name = 'Project\n## injected';
    project.geometry.bodies.push({
      id: 'body_md',
      name: 'beam | escaped\\name\n| injected row',
      category: 'solid',
      visible: true,
      locked: false,
      color: '#ffffff',
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      topology_ref: '',
      metadata: { shapeType: '<box>' },
    });

    const markdown = exportMarkdownSummary(project);
    expect(markdown).not.toContain('\n## injected');
    expect(markdown).toContain('# Project \\#\\# injected');
    expect(markdown).toContain('beam \\| escaped\\\\name<br>\\| injected row');
    expect(markdown).toContain('&lt;box&gt;');
  });
});

describe('artifact names and solver identifiers', () => {
  it('produces path-safe, portable artifact name components', () => {
    expect(sanitizeArtifactName('../../analysis:\u0000?.json')).toBe('analysis_.json');
    expect(sanitizeArtifactName('CON')).toBe('_CON');
    expect(sanitizeArtifactName(' . / \\ ')).toBe('artifact');
    expect(Array.from(sanitizeArtifactName('構造解析'.repeat(100))).length).toBeLessThanOrEqual(96);

    for (const value of deterministicStrings(300)) {
      const sanitized = sanitizeArtifactName(value);
      expect(sanitized).not.toMatch(/[<>:"/\\|?*]/);
      expect(Array.from(sanitized).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f);
      })).toBe(true);
      expect(sanitized).not.toBe('.');
      expect(sanitized).not.toBe('..');
    }
  });

  it('creates valid bounded solver IDs and resolves collisions deterministically', () => {
    for (const value of deterministicStrings(300)) {
      const identifier = solverIdentifier(value);
      expect(identifier).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(identifier.length).toBeLessThanOrEqual(63);
    }

    expect(solverIdentifier('1 inlet-patch')).toBe('entity_1_inlet_patch');
    expect(solverIdentifier('Crème brûlée')).toBe('Creme_brulee');
    expect(solverIdentifier('入口')).toBe('entity');

    const used = new Set<string>();
    expect(uniqueSolverIdentifier('wall top', used)).toBe('wall_top');
    expect(uniqueSolverIdentifier('wall-top', used)).toBe('wall_top_2');
    expect(uniqueSolverIdentifier('wall_top', used)).toBe('wall_top_3');
    expect(used.size).toBe(3);
  });
});
