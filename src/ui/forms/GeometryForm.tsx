import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateShape, DEFAULT_SHAPE_PARAMS } from '@/geometry/primitives/generators';
import { shapesJa, shapesEn, paramLabelsJa, paramLabelsEn } from '@/i18n/locales/shapes';
import type { AnyShapeParams } from '@/geometry/primitives/types';

const SHAPE_TYPES = Object.keys(DEFAULT_SHAPE_PARAMS);
const PARAM_EXCLUDE = ['shapeType'];

export function GeometryForm() {
  const { i18n } = useTranslation();
  const ir = useAppStore((s) => s.ir);
  const removeBody = useAppStore((s) => s.removeBody);
  const selectedIds = useAppStore((s) => s.selectedEntityIds);

  const [selectedShape, setSelectedShape] = useState('box');
  const [params, setParams] = useState<Record<string, unknown>>(
    () => ({ ...DEFAULT_SHAPE_PARAMS['box'] }),
  );

  const isJa = i18n.language === 'ja';
  const shapeNames = isJa ? shapesJa : shapesEn;
  const paramLabels = isJa ? paramLabelsJa : paramLabelsEn;

  const handleShapeChange = (type: string) => {
    setSelectedShape(type);
    setParams({ ...DEFAULT_SHAPE_PARAMS[type] });
  };

  const handleParamChange = (key: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setParams((prev) => ({ ...prev, [key]: num }));
    }
  };

  const handleCreate = () => {
    const shapeParams = { ...params, shapeType: selectedShape } as AnyShapeParams;
    const result = generateShape(shapeParams, shapeNames[selectedShape]);
    const store = useAppStore.getState();
    store.addBodyWithTopology(result.body, {
      faces: result.faces,
      edges: result.edges,
      vertices: result.vertices,
    });
  };

  const handleDeleteSelected = () => {
    selectedIds.forEach((id) => removeBody(id));
    useAppStore.getState().setSelectedEntities([]);
  };

  const paramKeys = Object.keys(params).filter((k) => !PARAM_EXCLUDE.includes(k));
  const bodies = ir.geometry.bodies;

  return (
    <div className="space-y-4">
      {/* Shape creation */}
      <div>
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {isJa ? '形状タイプ' : 'Shape Type'}
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {SHAPE_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => handleShapeChange(type)}
              className="px-2 py-2 rounded text-xs text-center transition-colors cursor-pointer"
              style={{
                backgroundColor: selectedShape === type ? 'var(--color-accent)' : 'var(--color-bg-input)',
                color: selectedShape === type ? '#fff' : 'var(--color-text-secondary)',
                border: `1px solid ${selectedShape === type ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              {shapeNames[type]}
            </button>
          ))}
        </div>
      </div>

      {/* Parameters */}
      <div>
        <label
          className="block text-sm font-bold mb-2"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {isJa ? 'パラメータ' : 'Parameters'}
        </label>
        <div className="space-y-2">
          {paramKeys.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span
                className="text-sm w-24 shrink-0"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {paramLabels[key] ?? key}
              </span>
              <input
                type="number"
                value={params[key] as number}
                onChange={(e) => handleParamChange(key, e.target.value)}
                step={key === 'segments' || key === 'columns' || key === 'floors' || key === 'divisions' ? 1 : 0.1}
                min={0.01}
                className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
                style={{
                  backgroundColor: 'var(--color-bg-input)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Create button */}
      <button
        onClick={handleCreate}
        className="w-full py-2.5 rounded text-sm font-bold cursor-pointer transition-colors"
        style={{
          backgroundColor: 'var(--color-accent)',
          color: '#fff',
        }}
      >
        {isJa ? '形状を作成' : 'Create Shape'}
      </button>

      {/* Existing bodies list */}
      {bodies.length > 0 && (
        <div>
          <label
            className="block text-sm font-bold mb-2"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {isJa ? '作成済みボディ' : 'Bodies'}
          </label>
          <div className="space-y-1">
            {bodies.map((body) => {
              const isSelected = selectedIds.includes(body.id);
              return (
                <div
                  key={body.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer"
                  style={{
                    backgroundColor: isSelected ? 'var(--color-bg-panel)' : 'var(--color-bg-input)',
                    color: 'var(--color-text-secondary)',
                  }}
                  onClick={() => useAppStore.getState().setSelectedEntities([body.id])}
                >
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: body.color }}
                  />
                  <span className="flex-1 truncate">{body.name}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {(body.metadata.shapeType as string) ?? ''}
                  </span>
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
              {isJa ? '選択を削除' : 'Delete Selected'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
