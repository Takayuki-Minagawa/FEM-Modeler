/** 0.2 already stores SI values. Upgrade artifacts without converting geometry again. */
export function migrateV02Artifacts(raw: Record<string, unknown>): Record<string, unknown> {
  const data = structuredClone(raw);
  data.convergence_studies ??= [];
  if (Array.isArray(data.results)) {
    data.results = data.results.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const result = { ...entry } as Record<string, unknown>;
      if (result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata)) {
        const metadata: Record<string, unknown> = { ...result.metadata };
        delete metadata.imported_for_model_revision;
        metadata.provenance_verified = false;
        metadata.input_match = 'unverified';
        result.metadata = metadata;
      }
      if (result.status === 'complete') result.status = 'partial';
      return result;
    });
  }
  return data;
}
