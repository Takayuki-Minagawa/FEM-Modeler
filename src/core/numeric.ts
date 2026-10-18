/** Complete decimal/scientific syntax only. Infinity from exponent overflow is returned for callers to diagnose. */
export function parseDecimalNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Parse a complete finite decimal, including scientific notation; never accept a prefix. */
export function parseFiniteNumber(text: string): number | null {
  const value = parseDecimalNumber(text);
  return value !== null && Number.isFinite(value) ? value : null;
}
