import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { generateShape, DEFAULT_SHAPE_PARAMS } from '@/geometry/primitives/generators';
import { shapesJa, shapesEn, paramLabelsJa, paramLabelsEn } from '@/i18n/locales/shapes';
import type { AnyShapeParams } from '@/geometry/primitives/types';
import type { GeometryBody } from '@/core/ir/types';

const SHAPE_TYPES = Object.keys(DEFAULT_SHAPE_PARAMS);
const PARAM_EXCLUDE = ['shapeType'];
const AXIS_LABELS = ['X', 'Y', 'Z'] as const;

type TupleInput = [string, string, string];

function formatTuple(values: [number, number, number]): TupleInput {
  return values.map((value) => `${Number(value.toFixed(4))}`) as TupleInput;
}

function parseTuple(values: TupleInput, fallback: [number, number, number]): [number, number, number] {
  return values.map((value, index) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback[index];
  }) as [number, number, number];
}

function parseScale(values: TupleInput, fallback: [number, number, number]): [number, number, number] {
  return values.map((value, index) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback[index];
  }) as [number, number, number];
}

function updateTupleInput(
  tuple: TupleInput,
  index: number,
  nextValue: string,
): TupleInput {
  const next = [...tuple] as TupleInput;
  next[index] = nextValue;
  return next;
}

function estimatePatternOffset(body: GeometryBody | null): TupleInput {
  if (!body) {
    return ['2', '0', '0'];
  }

  const meta = body.metadata;
  const scaleX = Math.max(Math.abs(body.transform.scale[0]), 0.01);
  const shapeType = meta.shapeType as string | undefined;
  let stepX = 2;

  switch (shapeType) {
    case 'box':
    case 'plate':
    case 'plateWithHole':
    case 'lBracket':
      stepX = Number(meta.width ?? 2) * scaleX;
      break;
    case 'cylinder':
      stepX = Number(meta.radius ?? 1) * 2 * scaleX;
      break;
    case 'pipe':
      stepX = Number(meta.outerRadius ?? 1) * 2 * scaleX;
      break;
    case 'frame2d':
      stepX = Number(meta.spanX ?? 6) * scaleX;
      break;
    case 'truss2d':
      stepX = Number(meta.span ?? 10) * scaleX;
      break;
    case 'channel':
      stepX = Number(meta.length ?? 6) * scaleX;
      break;
    default:
      stepX = 2;
      break;
  }

  return [`${Number((stepX + 0.5).toFixed(4))}`, '0', '0'];
}

function bodyEditorKey(body: GeometryBody): string {
  const { position, rotation, scale } = body.transform;
  return `${body.id}:${body.name}:${body.visible}:${position}:${rotation}:${scale}`;
}

export function GeometryForm() {
  const { i18n } = useTranslation();
  const ir = useAppStore((s) => s.ir);
  const removeBody = useAppStore((s) => s.removeBody);
  const updateBody = useAppStore((s) => s.updateBody);
  const duplicateBodiesLinear = useAppStore((s) => s.duplicateBodiesLinear);
  const setSelectedEntities = useAppStore((s) => s.setSelectedEntities);
  const selectedIds = useAppStore((s) => s.selectedEntityIds);

  const [selectedShape, setSelectedShape] = useState('box');
  const [params, setParams] = useState<Record<string, unknown>>(
    () => ({ ...DEFAULT_SHAPE_PARAMS['box'] }),
  );

  const isJa = i18n.language === 'ja';
  const shapeNames = isJa ? shapesJa : shapesEn;
  const paramLabels = isJa ? paramLabelsJa : paramLabelsEn;
  const bodies = ir.geometry.bodies;
  const selectedBodies = bodies.filter((body) => selectedIds.includes(body.id));
  const selectedBody = selectedIds.length === 1
    ? bodies.find((body) => body.id === selectedIds[0]) ?? null
    : null;

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
    selectedBodies.forEach((body) => removeBody(body.id));
    setSelectedEntities([]);
  };

  const paramKeys = Object.keys(params).filter((k) => !PARAM_EXCLUDE.includes(k));

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
                  <span className="flex-1 truncate">
                    {body.name}
                    {!body.visible && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        {isJa ? '非表示' : 'Hidden'}
                      </span>
                    )}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {(body.metadata.shapeType as string) ?? ''}
                  </span>
                  <button
                    type="button"
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
                      ? (isJa ? '隠す' : 'Hide')
                      : (isJa ? '表示' : 'Show')}
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
              {isJa ? '選択を削除' : 'Delete Selected'}
            </button>
          )}
        </div>
      )}

      {selectedBody && (
        <BodyEditor
          key={bodyEditorKey(selectedBody)}
          body={selectedBody}
          isJa={isJa}
          onApply={(updates) => updateBody(selectedBody.id, updates)}
        />
      )}

      {selectedBodies.length > 0 && (
        <LinearPatternEditor
          key={selectedBodies.map((body) => body.id).join(':')}
          bodyIds={selectedBodies.map((body) => body.id)}
          defaultOffset={estimatePatternOffset(selectedBody ?? selectedBodies[0] ?? null)}
          isJa={isJa}
          onCreate={(copies, offset) => {
            const createdIds = duplicateBodiesLinear(selectedBodies.map((body) => body.id), copies, offset);
            if (createdIds.length > 0) {
              setSelectedEntities(createdIds);
            }
          }}
        />
      )}
    </div>
  );
}

interface BodyEditorProps {
  body: GeometryBody;
  isJa: boolean;
  onApply: (updates: {
    name: string;
    visible: boolean;
    transform: {
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
    };
  }) => void;
}

function BodyEditor({ body, isJa, onApply }: BodyEditorProps) {
  const [bodyName, setBodyName] = useState(body.name);
  const [bodyVisible, setBodyVisible] = useState(body.visible);
  const [positionInputs, setPositionInputs] = useState<TupleInput>(formatTuple(body.transform.position));
  const [rotationInputs, setRotationInputs] = useState<TupleInput>(formatTuple(body.transform.rotation));
  const [scaleInputs, setScaleInputs] = useState<TupleInput>(formatTuple(body.transform.scale));

  return (
    <div className="space-y-3">
      <label
        className="block text-sm font-bold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {isJa ? 'ボディ編集' : 'Body Edit'}
      </label>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm w-24 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
            {isJa ? '名前' : 'Name'}
          </span>
          <input
            type="text"
            value={bodyName}
            onChange={(e) => setBodyName(e.target.value)}
            className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
            style={{
              backgroundColor: 'var(--color-bg-input)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          />
        </div>

        <label
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <input
            type="checkbox"
            checked={bodyVisible}
            onChange={(e) => setBodyVisible(e.target.checked)}
          />
          {isJa ? '表示する' : 'Visible'}
        </label>
      </div>

      <TupleEditor
        label={isJa ? '移動' : 'Position'}
        values={positionInputs}
        onChange={setPositionInputs}
        step="0.1"
      />
      <TupleEditor
        label={isJa ? '回転 (deg)' : 'Rotation (deg)'}
        values={rotationInputs}
        onChange={setRotationInputs}
        step="1"
      />
      <TupleEditor
        label={isJa ? 'スケール' : 'Scale'}
        values={scaleInputs}
        onChange={setScaleInputs}
        step="0.1"
        min="0.01"
      />

      <button
        type="button"
        onClick={() => {
          const nextName = bodyName.trim();
          onApply({
            name: nextName.length > 0 ? nextName : body.name,
            visible: bodyVisible,
            transform: {
              position: parseTuple(positionInputs, body.transform.position),
              rotation: parseTuple(rotationInputs, body.transform.rotation),
              scale: parseScale(scaleInputs, body.transform.scale),
            },
          });
        }}
        className="w-full py-2 rounded text-sm font-bold cursor-pointer transition-colors"
        style={{
          backgroundColor: 'var(--color-bg-input)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
        }}
      >
        {isJa ? '編集を適用' : 'Apply Edits'}
      </button>
    </div>
  );
}

interface LinearPatternEditorProps {
  bodyIds: string[];
  defaultOffset: TupleInput;
  isJa: boolean;
  onCreate: (copies: number, offset: [number, number, number]) => void;
}

function LinearPatternEditor({
  bodyIds,
  defaultOffset,
  isJa,
  onCreate,
}: LinearPatternEditorProps) {
  const [patternCopies, setPatternCopies] = useState('1');
  const [patternOffset, setPatternOffset] = useState<TupleInput>(defaultOffset);

  return (
    <div className="space-y-3">
      <label
        className="block text-sm font-bold"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {isJa ? '線形パターン複製' : 'Linear Pattern'}
      </label>

      <div className="flex items-center gap-2">
        <span className="text-sm w-24 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
          {isJa ? '複製数' : 'Copies'}
        </span>
        <input
          type="number"
          min={1}
          step={1}
          value={patternCopies}
          onChange={(e) => setPatternCopies(e.target.value)}
          className="flex-1 px-2 py-1.5 rounded text-sm outline-none"
          style={{
            backgroundColor: 'var(--color-bg-input)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
      </div>

      <TupleEditor
        label={isJa ? 'オフセット' : 'Offset'}
        values={patternOffset}
        onChange={setPatternOffset}
        step="0.1"
      />

      <button
        type="button"
        onClick={() => {
          const copies = Math.max(0, Math.floor(Number.parseInt(patternCopies, 10) || 0));
          if (copies < 1 || bodyIds.length === 0) {
            return;
          }
          onCreate(copies, parseTuple(patternOffset, [2, 0, 0]));
        }}
        className="w-full py-2 rounded text-sm font-bold cursor-pointer transition-colors"
        style={{
          backgroundColor: 'var(--color-accent)',
          color: '#fff',
        }}
      >
        {isJa ? 'パターン複製を作成' : 'Create Pattern Copies'}
      </button>
    </div>
  );
}

interface TupleEditorProps {
  label: string;
  values: TupleInput;
  onChange: (values: TupleInput) => void;
  step: string;
  min?: string;
}

function TupleEditor({
  label,
  values,
  onChange,
  step,
  min,
}: TupleEditorProps) {
  return (
    <div>
      <label
        className="block text-sm font-bold mb-2"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {label}
      </label>
      <div className="grid grid-cols-3 gap-2">
        {AXIS_LABELS.map((axis, index) => (
          <div key={axis} className="space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {axis}
            </span>
            <input
              type="number"
              value={values[index]}
              onChange={(e) => onChange(updateTupleInput(values, index, e.target.value))}
              step={step}
              min={min}
              className="w-full px-2 py-1.5 rounded text-sm outline-none"
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
  );
}
