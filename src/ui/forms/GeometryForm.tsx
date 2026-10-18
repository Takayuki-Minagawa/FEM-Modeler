import { shapesJa, shapesEn } from '@/i18n/locales/shapes';
import { geometryEditorJa, geometryEditorEn } from '@/i18n/locales/geometry-editor';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { REGENERABLE_PARAMETERS } from '@/geometry/regeneration';
import { ShapeCreation } from './geometry/ShapeCreation';
import { BodyTransformEditor } from './geometry/BodyTransformEditor';
import { LinearPatternEditor } from './geometry/LinearPatternEditor';
import { DimensionEditor } from './geometry/DimensionEditor';
import { bodyEditorKey, estimatePatternOffset } from './geometry/body-editing';

export function GeometryForm() {
  const { t, i18n } = useTranslation();
  const ir = useAppStore((s) => s.ir);
  const removeBodies = useAppStore((s) => s.removeBodies);
  const updateBody = useAppStore((s) => s.updateBody);
  const duplicateBodiesLinear = useAppStore((s) => s.duplicateBodiesLinear);
  const setSelectedEntities = useAppStore((s) => s.setSelectedEntities);
  const selectedIds = useAppStore((s) => s.selectedEntityIds);
  const unitSystem = ir.units.system_name;
  const isJa = i18n.language === 'ja';
  const copy = isJa ? geometryEditorJa : geometryEditorEn;
  const [patternStatus, setPatternStatus] = useState('');
  const bodies = ir.geometry.bodies;
  const selectedBodies = bodies.filter((body) => selectedIds.includes(body.id));
  const selectedBody = selectedIds.length === 1 ? bodies.find((body) => body.id === selectedIds[0]) ?? null : null;
  const handleDeleteSelected = () => {
    removeBodies(selectedBodies.map((body) => body.id));
    setSelectedEntities([]);
  };
  return (
    <div className="space-y-4">
      <ShapeCreation isJa={isJa} unitSystem={unitSystem} />
      {/* Existing bodies list */}
      {bodies.length > 0 && (
        <div>
          <label
            className="block text-sm font-bold mb-2"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {copy.bodies}
          </label>
          <div className="space-y-1">
            {bodies.map((body) => {
              const isSelected = selectedIds.includes(body.id);
              return (
                <div
                  key={body.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
                  style={{
                    backgroundColor: isSelected ? 'var(--color-bg-panel)' : 'var(--color-bg-input)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: body.color }}
                  />
                  <button type="button" data-entity-id={body.id} aria-label={t('workflow.selectEntity', { name: `${body.name} (${body.id})` })} aria-pressed={isSelected} onClick={() => useAppStore.getState().setSelectedEntities([body.id])} className="flex-1 truncate text-left cursor-pointer">
                    {body.name}
                    {!body.visible && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {copy.hidden}
                      </span>
                    )}
                  </button>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {(isJa ? shapesJa : shapesEn)[String(body.metadata.shapeType)] ?? String(body.metadata.shapeType ?? '')}
                  </span>
                  <button
                    type="button"
                    aria-label={`${body.visible ? (copy.hide) : (copy.show)}: ${body.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateBody(body.id, { visible: !body.visible });
                    }}
                    className="px-2 py-0.5 rounded text-xs cursor-pointer"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {body.visible
                      ? (copy.hideShort)
                      : (copy.show)}
                  </button>
                </div>
              );
            })}
          </div>

          {selectedIds.length > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="w-full mt-2 py-1.5 rounded text-sm cursor-pointer transition-colors"
              style={{
                backgroundColor: 'transparent',
                color: 'var(--color-error)',
                border: '1px solid var(--color-error)',
              }}
            >
              {copy.deleteSelected}
            </button>
          )}
        </div>
      )}

      {selectedBody && (
        <BodyTransformEditor
          key={`${bodyEditorKey(selectedBody)}:${unitSystem}`}
          body={selectedBody}
          isJa={isJa}
          unitSystem={unitSystem}
          onApply={(updates) => updateBody(selectedBody.id, updates)}
        />
      )}

      {selectedBody && REGENERABLE_PARAMETERS[String(selectedBody.metadata.shapeType)] && <DimensionEditor key={`${selectedBody.id}:${JSON.stringify(selectedBody.metadata)}:${unitSystem}`} body={selectedBody} isJa={isJa} unitSystem={unitSystem} onApplied={setPatternStatus} />}

      {selectedBodies.length > 0 && (
        <LinearPatternEditor
          key={`${selectedBodies.map((body) => body.id).join(':')}:${unitSystem}`}
          bodyIds={selectedBodies.map((body) => body.id)}
          defaultOffset={estimatePatternOffset(selectedBody ?? selectedBodies[0] ?? null)}
          isJa={isJa}
          unitSystem={unitSystem}
          onCreate={(copies, offset) => {
            const createdIds = duplicateBodiesLinear(selectedBodies.map((body) => body.id), copies, offset);
            if (createdIds.length > 0) {
              setSelectedEntities(createdIds);
              setPatternStatus(copy.patternCreated.replace('{{count}}', String(createdIds.length)));
            }
          }}
        />
      )}
      {patternStatus && <p role="status" className="text-xs">{patternStatus}</p>}
    </div>
  );
}
