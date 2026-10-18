import type { AnalysisCase, ParticipationField, ParticipationMode } from './types';

export type { ParticipationField, ParticipationMode } from './types';

export const PARTICIPATION_FIELDS: readonly ParticipationField[] = [
  'participating_material_ids',
  'participating_section_ids',
  'participating_bc_ids',
  'participating_load_ids',
  'participating_ic_ids',
];

/** Interpret older files without rewriting their IDs or changing their meaning. */
export function getParticipationMode(analysisCase: AnalysisCase, field: ParticipationField): ParticipationMode {
  return analysisCase.participation_modes?.[field]
    ?? (analysisCase[field].length > 0 ? 'explicit' : 'all');
}

/** undefined means all; an empty array means no participants. */
export function participatingIds(analysisCase: AnalysisCase | undefined | null, field: ParticipationField): string[] | undefined {
  if (!analysisCase) return undefined;
  const mode = getParticipationMode(analysisCase, field);
  return mode === 'all' ? undefined : mode === 'none' ? [] : analysisCase[field];
}

export function selectParticipatingItems<T extends { id: string }>(
  analysisCase: AnalysisCase | undefined | null,
  field: ParticipationField,
  items: T[],
): T[] {
  const ids = participatingIds(analysisCase, field);
  if (ids === undefined) return items;
  const selected = new Set(ids);
  return items.filter((item) => selected.has(item.id));
}

/** An edit records intent, so removing the last ID can never mean "all". */
export function participationUpdate(
  analysisCase: AnalysisCase,
  field: ParticipationField,
  ids: string[],
  mode: ParticipationMode = ids.length > 0 ? 'explicit' : 'none',
): Partial<AnalysisCase> {
  return {
    [field]: mode === 'explicit' ? [...new Set(ids)] : [],
    participation_modes: { ...analysisCase.participation_modes, [field]: mode },
  };
}
