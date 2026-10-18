/** Suggest a readable name for a new UI entity without renaming existing/imported data. */
export function uniqueEntityName(baseName: string, existing: readonly { name: string }[]): string {
  return uniqueNameInSet(baseName, new Set(existing.map((item) => item.name)));
}

/** Batch commands reuse a name index rather than rebuilding it for every entity. */
export function uniqueNameInSet(baseName: string, names: ReadonlySet<string>): string {
  if (!names.has(baseName)) return baseName;
  let suffix = 2;
  while (names.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}
