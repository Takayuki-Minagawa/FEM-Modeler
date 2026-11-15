import type { GeometryBody, UnitSystemName } from '@/core/ir/types';
import { fromSI, quantityUnitLabel } from '@/core/units';
import { bodyLocalExtents } from '@/geometry/body-extents';
import { geometryEditorEn, geometryEditorJa } from '@/i18n/locales/geometry-editor';

interface Props { body: GeometryBody; isJa: boolean; unitSystem: UnitSystemName }

export function BodyExtentsReadout({ body, isJa, unitSystem }: Props) {
  const extents = bodyLocalExtents(body);
  if (!extents) return null;
  const copy = isJa ? geometryEditorJa : geometryEditorEn;
  const unit = quantityUnitLabel('length', unitSystem);
  const text = extents.map((value) => `${Number(fromSI(value, 'length', unitSystem).toPrecision(6))}`).join(' × ');
  return (
    <p className="text-xs" style={{ color: 'var(--color-text-muted)' }} data-testid="body-extents">
      {copy.extents}: {text} {unit}
    </p>
  );
}
