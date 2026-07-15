/**
 * Values accepted by the text artifact serializers.
 *
 * Keeping numbers as numbers is important: a legitimate negative numeric value
 * is not a spreadsheet formula, while an untrusted string beginning with `-`
 * can be one.
 */
export type ArtifactScalar = string | number | boolean | bigint | null | undefined;

const SPREADSHEET_FORMULA_PREFIX = /^\s*[=+\-@]/;
const CSV_REQUIRES_QUOTES = /[",\r\n]/;
const INVISIBLE_FILENAME_CONTROLS = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;
const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SOLVER_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_FILENAME_PUNCTUATION = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function stringifyArtifactScalar(value: ArtifactScalar): string {
  if (value == null) return '';
  return String(value);
}

/**
 * Prevents an untrusted string cell from being evaluated as a formula by
 * spreadsheet applications. The apostrophe is intentionally inserted before
 * any leading whitespace so the first character cannot be formula syntax.
 */
export function neutralizeSpreadsheetFormula(value: string): string {
  return SPREADSHEET_FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

/** Serializes one RFC 4180 CSV field, including spreadsheet formula defense. */
export function escapeCsvCell(value: ArtifactScalar): string {
  const rawValue = stringifyArtifactScalar(value);
  const safeValue = typeof value === 'string'
    ? neutralizeSpreadsheetFormula(rawValue)
    : rawValue;

  if (!CSV_REQUIRES_QUOTES.test(safeValue)) return safeValue;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

/** Serializes one RFC 4180 record. */
export function csvRow(values: readonly ArtifactScalar[]): string {
  return values.map(escapeCsvCell).join(',');
}

/** Serializes RFC 4180 records using the mandated CRLF record separator. */
export function serializeCsv(records: readonly (readonly ArtifactScalar[])[]): string {
  return records.map(csvRow).join('\r\n');
}

function escapeMarkdownHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escapes arbitrary text for a Markdown table cell. Backslashes are escaped
 * before pipes, and physical newlines become an explicit in-cell line break.
 */
export function escapeMarkdownTableCell(value: ArtifactScalar): string {
  return escapeMarkdownHtml(stringifyArtifactScalar(value))
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

/** Serializes a Markdown table row without allowing cells to add columns. */
export function markdownTableRow(values: readonly ArtifactScalar[]): string {
  return `| ${values.map(escapeMarkdownTableCell).join(' | ')} |`;
}

/**
 * Escapes untrusted text used in headings or list items. Physical newlines are
 * flattened so a project name cannot inject a new Markdown block.
 */
export function escapeMarkdownInline(value: ArtifactScalar): string {
  return escapeMarkdownHtml(stringifyArtifactScalar(value))
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/([\\`*_[\]{}()#+.!|>~-])/g, '\\$1');
}

function trimToCodePointLength(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('');
}

function replaceUnsafeFilenameCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControlCharacter = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    return isControlCharacter || UNSAFE_FILENAME_PUNCTUATION.has(character) ? '_' : character;
  }).join('');
}

function sanitizeFilenameCandidate(value: string, maxLength: number): string {
  let candidate = replaceUnsafeFilenameCharacters(
    value.normalize('NFKC')
    .replace(INVISIBLE_FILENAME_CONTROLS, '')
  )
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[-_.\s]+|[-_.\s]+$/g, '');

  candidate = trimToCodePointLength(candidate, maxLength)
    .replace(/[.\s]+$/g, '');

  if (WINDOWS_RESERVED_FILENAME.test(candidate)) candidate = `_${candidate}`;
  return candidate;
}

/**
 * Produces a path-separator-free, cross-platform filename component suitable
 * for a browser download. The result never represents `.` or `..`.
 */
export function sanitizeArtifactName(
  value: string,
  fallback = 'artifact',
  maxLength = 96,
): string {
  const boundedLength = Math.max(1, Math.floor(maxLength));
  const candidate = sanitizeFilenameCandidate(value, boundedLength);
  if (candidate) return candidate;

  return sanitizeFilenameCandidate(fallback, boundedLength) || 'artifact'.slice(0, boundedLength);
}

function normalizeSolverFallback(fallback: string): string {
  const normalized = fallback
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return 'entity';
  return /^[A-Za-z_]/.test(normalized) ? normalized : `entity_${normalized}`;
}

/** Produces a solver-safe identifier matching `[A-Za-z_][A-Za-z0-9_]*`. */
export function solverIdentifier(
  value: string,
  fallback = 'entity',
  maxLength = 63,
): string {
  const boundedLength = Math.max(1, Math.floor(maxLength));
  const safeFallback = normalizeSolverFallback(fallback);
  let identifier = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!identifier) identifier = safeFallback;
  if (!/^[A-Za-z_]/.test(identifier)) identifier = `${safeFallback}_${identifier}`;
  identifier = trimToCodePointLength(identifier, boundedLength).replace(/_+$/g, '');

  // A one-character maximum can truncate an alphabetic fallback safely.
  if (!identifier || !SOLVER_IDENTIFIER_PATTERN.test(identifier)) {
    identifier = trimToCodePointLength(safeFallback, boundedLength);
  }
  return identifier;
}

/**
 * Allocates a solver-safe identifier and adds it to `usedIdentifiers`.
 * Collisions receive stable `_2`, `_3`, ... suffixes within the registry.
 */
export function uniqueSolverIdentifier(
  value: string,
  usedIdentifiers: Set<string>,
  fallback = 'entity',
  maxLength = 63,
): string {
  const boundedLength = Math.max(1, Math.floor(maxLength));
  const base = solverIdentifier(value, fallback, boundedLength);
  if (!usedIdentifiers.has(base)) {
    usedIdentifiers.add(base);
    return base;
  }

  for (let index = 2; ; index += 1) {
    const suffix = `_${index}`;
    const prefixLength = Math.max(1, boundedLength - suffix.length);
    const candidate = `${base.slice(0, prefixLength).replace(/_+$/g, '')}${suffix}`;
    if (!usedIdentifiers.has(candidate)) {
      usedIdentifiers.add(candidate);
      return candidate;
    }
  }
}
