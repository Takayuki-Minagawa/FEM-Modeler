import { importSTLAsync } from '@/geometry/import/stl-async';
import { Modal } from './Modal';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { STL_SOURCE_UNIT_TO_METERS, type STLSourceUnit, type STLImportResult } from '@/geometry/import/stl-loader';
import { MAX_CAD_SOURCE_BYTES } from '@/geometry/import/cad-source';
import { cacheSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { useAppActionsContext } from '@/hooks/useAppActionsContext';
import { useProjectFileLoader } from '@/hooks/useProjectFileLoader';
import { useViewerState } from '@/viewer/view-state';
import { applyTransformToPoint } from '@/geometry/transforms';

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_STL_FILE_BYTES = 50 * 1024 * 1024;

export function ImportDialog({ isOpen, onClose }: ImportDialogProps) {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const { addActivity } = useAppActionsContext();
  const { loadFromFile } = useProjectFileLoader();
  const addBodyWithTopology = useAppStore((s) => s.addBodyWithTopology);

  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const activeImport = useRef<AbortController | null>(null);
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (next.projectSession !== previous.projectSession) activeImport.current?.abort();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      activeImport.current?.abort();
      activeImport.current = null;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!isOpen) activeImport.current?.abort();
    return () => activeImport.current?.abort();
  }, [isOpen]);
  const [stlSourceUnit, setStlSourceUnit] = useState<STLSourceUnit>('mm');

  if (!isOpen) return null;

  const handleClose = () => {
    activeImport.current?.abort();
    onClose();
  };

  const handleFile = async (file: File) => {
    activeImport.current?.abort(); activeImport.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setBusyFormat(null);
    setStatus(null);
    const ext = file.name.split('.').pop()?.toLowerCase();

    if ((ext === 'zip' && file.name.toLowerCase().endsWith('.fem.zip'))
      || ext === 'json' || file.name.endsWith('.fem.json')) {
      try {
        const result = await loadFromFile(file);
        if (result.success) {
          const msg = isJa
            ? `プロジェクト "${result.projectName}" を読み込みました。`
            : `Loaded project "${result.projectName}".`;
          setStatus({ type: 'success', message: msg });
          closeTimer.current = setTimeout(onClose, 1000);
        } else {
          setStatus({ type: 'error', message: result.error ?? 'Failed to load.' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ type: 'error', message });
      }
    } else if (ext === 'stl' || ['step', 'stp', 'iges', 'igs'].includes(ext ?? '')) {
      const controller = new AbortController(); activeImport.current = controller;
      const session = useAppStore.getState().projectSession;
      const format = ext === 'stl' ? 'STL' : ext === 'step' || ext === 'stp' ? 'STEP' : 'IGES';
      const current = () => mounted.current && activeImport.current === controller && !controller.signal.aborted
        && useAppStore.getState().projectSession === session;
      controller.signal.addEventListener('abort', () => {
        if (mounted.current && activeImport.current === controller) {
          setBusyFormat(null);
          setStatus({ type: 'error', message: isJa ? '読込を取り消しました。' : 'Import cancelled.' });
        }
      }, { once: true });
      setBusyFormat(format);
      try {
        const limit = ext === 'stl' ? MAX_STL_FILE_BYTES : MAX_CAD_SOURCE_BYTES;
        if (file.size > limit) {
          throw new Error(`${format} exceeds the ${limit / 1024 / 1024} MB file-size safety limit.`);
        }
        const buffer = await file.arrayBuffer();
        if (!current()) return;
        let result: STLImportResult;
        if (ext === 'stl') result = await importSTLAsync(buffer, file.name, STL_SOURCE_UNIT_TO_METERS[stlSourceUnit], stlSourceUnit, controller.signal);
        else {
          const { importCADAsync } = await import('@/geometry/import/cad-async');
          if (!current()) return;
          result = await importCADAsync(buffer, file.name, controller.signal);
        }
        if (!current()) { result.geometry?.dispose(); return; }
        if (result.success && result.body && result.asset) {
          addBodyWithTopology(result.body, { faces: result.faces, assets: [result.asset] });
          if (result.geometry) {
            cacheSTLGeometry(result.body.id, result.geometry);
          }
          if (format !== 'STL') {
            const { min, max } = result.asset.bounds;
            const transform = result.body.transform;
            const points = [min[0], max[0]].flatMap((x) => [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => applyTransformToPoint([x, y, z], transform))));
            useViewerState.getState().set({ resultId: '', fieldId: '', probe: null });
            useViewerState.getState().focusPoints(points);
          }
          addActivity(
            'success',
            isJa
              ? `${format} "${file.name}" を読み込みました。`
              : `Imported ${format} "${file.name}".`,
          );
          setStatus({ type: 'success', message: isJa ? `${format} "${file.name}" (${result.triangleCount} 三角形) を読み込みました。` : `Imported ${format} "${file.name}" (${result.triangleCount} triangles).` });
        } else {
          result.geometry?.dispose();
          addActivity('error', result.error ?? `${format} import failed.`);
          setStatus({ type: 'error', message: result.error ?? `${format} import failed.` });
        }
      } catch (error) {
        if (!current() || (error instanceof Error && error.name === 'AbortError')) return;
        const message = error instanceof Error ? error.message : String(error);
        addActivity('error', message);
        setStatus({ type: 'error', message });
      } finally {
        if (activeImport.current === controller) {
          activeImport.current = null;
          if (mounted.current) setBusyFormat(null);
        }
      }
    } else {
      addActivity(
        'warning',
        isJa ? `未対応のファイル形式です: .${ext}` : `Unsupported file format: .${ext}`,
      );
      setStatus({ type: 'error', message: isJa ? `未対応のファイル形式です: .${ext}` : `Unsupported file format: .${ext}` });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const handleBrowse = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.fem.json,.fem.zip,.stl,.step,.stp,.iges,.igs';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void handleFile(file);
    };
    input.click();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} labelledBy="import-dialog-title" className="max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 id="import-dialog-title" className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
            {isJa ? 'インポート' : 'Import'}
          </h2>
          <button onClick={handleClose} className="px-3 py-1 text-sm rounded cursor-pointer" style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-secondary)' }}>
            {isJa ? '閉じる' : 'Close'}
          </button>
        </div>

        <div className="p-6">
          <label className="block text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="block mb-1">{isJa ? 'STL座標の元単位（STLには単位情報がありません）' : 'STL source coordinate unit (STL is unitless)'}</span>
            <select
              value={stlSourceUnit}
              onChange={(event) => setStlSourceUnit(event.target.value as STLSourceUnit)}
              className="w-full px-2 py-1.5 rounded"
              style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            >
              <option value="mm">mm</option>
              <option value="m">m</option>
              <option value="cm">cm</option>
              <option value="in">inch</option>
              <option value="ft">ft</option>
            </select>
          </label>
          <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
            {isJa ? 'STEP/IGESはファイル内の単位を自動解釈します。上の元単位の指定はSTLのみに適用されます。' : 'STEP/IGES units are read from the file automatically. The source-unit selection above applies only to STL.'}
            {' '}{isJa ? 'CAD機能の初回利用時は約66 MBをダウンロードします。読み込んだCAD形状の解析メッシュ生成・ソルバ出力は未対応です。' : 'First use of CAD downloads about 66 MB. Analysis meshing and solver export of imported CAD are not yet supported.'}
          </p>
          {/* Drop zone */}
          <button
            type="button"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={handleBrowse}
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors"
            style={{
              borderColor: dragOver ? 'var(--color-accent)' : 'var(--color-border)',
              backgroundColor: dragOver ? 'rgba(74,144,217,0.1)' : 'transparent',
            }}
          >
            <div className="text-3xl mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {dragOver ? '\u2B07' : '\u{1F4C1}'}
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {isJa ? 'ファイルをドロップまたはクリックして選択' : 'Drop file or click to browse'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {isJa ? '対応: .fem.json, .fem.zip, .stl, .step, .stp, .iges, .igs' : 'Supported: .fem.json, .fem.zip, .stl, .step, .stp, .iges, .igs'}
            </p>
          </button>

          {busyFormat && <div className="mt-4 text-sm flex items-center gap-3">
            <p role="status">{isJa ? `${busyFormat}を変換しています…` : `Converting ${busyFormat}…`}</p>
            <button type="button" onClick={() => activeImport.current?.abort()}>{isJa ? '読込を取消' : 'Cancel import'}</button>
          </div>}
          {/* Status */}
          {status && (
            <div role="status" aria-live="polite" className="mt-4 p-3 rounded text-sm" style={{
              backgroundColor: status.type === 'success' ? 'rgba(76,175,80,0.1)' : 'rgba(244,67,54,0.1)',
              color: status.type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
            }}>
              {status.message}
            </div>
          )}
        </div>
    </Modal>
  );
}
