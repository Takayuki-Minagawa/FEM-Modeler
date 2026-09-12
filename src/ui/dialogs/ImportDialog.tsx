import { importSTLAsync } from '@/geometry/import/stl-async';
import { Modal } from './Modal';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { STL_SOURCE_UNIT_TO_METERS, type STLSourceUnit } from '@/geometry/import/stl-loader';
import { cacheSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { useAppActionsContext } from '@/hooks/useAppActionsContext';
import { useProjectFileLoader } from '@/hooks/useProjectFileLoader';

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
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isOpen) activeImport.current?.abort();
    return () => activeImport.current?.abort();
  }, [isOpen]);
  const [stlSourceUnit, setStlSourceUnit] = useState<STLSourceUnit>('mm');

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    activeImport.current?.abort(); activeImport.current = null;
    setBusy(false);
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
          setTimeout(onClose, 1000);
        } else {
          setStatus({ type: 'error', message: result.error ?? 'Failed to load.' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ type: 'error', message });
      }
    } else if (ext === 'stl') {
      const controller = new AbortController(); activeImport.current = controller;
      setBusy(true);
      try {
        if (file.size > MAX_STL_FILE_BYTES) {
          throw new Error('STL exceeds the 50 MB file-size safety limit.');
        }
        const buffer = await file.arrayBuffer();
        const result = await importSTLAsync(buffer, file.name, STL_SOURCE_UNIT_TO_METERS[stlSourceUnit], stlSourceUnit, controller.signal);
        if (controller.signal.aborted) { result.geometry?.dispose(); return; }
        if (result.success && result.body && result.asset) {
          addBodyWithTopology(result.body, { faces: result.faces, assets: [result.asset] });
          if (result.geometry) {
            cacheSTLGeometry(result.body.id, result.geometry);
          }
          addActivity(
            'success',
            isJa
              ? `STL "${file.name}" を読み込みました。`
              : `Imported STL "${file.name}".`,
          );
          setStatus({ type: 'success', message: isJa ? `STL "${file.name}" (${result.triangleCount} 三角形) を読み込みました。` : `Imported STL "${file.name}" (${result.triangleCount} triangles).` });
        } else {
          addActivity('error', result.error ?? 'STL import failed.');
          setStatus({ type: 'error', message: result.error ?? 'STL import failed.' });
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : String(error);
        addActivity('error', message);
        setStatus({ type: 'error', message });
      } finally {
        if (activeImport.current === controller) setBusy(false);
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
    input.accept = '.json,.fem.json,.fem.zip,.stl';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void handleFile(file);
    };
    input.click();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="import-dialog-title" className="max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 id="import-dialog-title" className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
            {isJa ? 'インポート' : 'Import'}
          </h2>
          <button onClick={onClose} className="px-3 py-1 text-sm rounded cursor-pointer" style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-secondary)' }}>
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
              {isJa ? '対応: .fem.json, .fem.zip, .stl' : 'Supported: .fem.json, .fem.zip, .stl'}
            </p>
          </button>

          {busy && <p role="status" className="mt-4 text-sm">{isJa ? 'STLを解析しています…' : 'Parsing STL…'}</p>}
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
