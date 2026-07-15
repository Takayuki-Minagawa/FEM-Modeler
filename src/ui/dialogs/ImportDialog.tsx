import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { importSTL, STL_SOURCE_UNIT_TO_METERS, type STLSourceUnit } from '@/geometry/import/stl-loader';
import { cacheSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { useAppContext } from '@/hooks/useAppContext';
import { useProjectFileLoader } from '@/hooks/useProjectFileLoader';

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_STL_FILE_BYTES = 50 * 1024 * 1024;

export function ImportDialog({ isOpen, onClose }: ImportDialogProps) {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const { addActivity } = useAppContext();
  const { loadFromFile } = useProjectFileLoader();
  const addBodyWithTopology = useAppStore((s) => s.addBodyWithTopology);

  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stlSourceUnit, setStlSourceUnit] = useState<STLSourceUnit>('mm');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
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
      try {
        if (file.size > MAX_STL_FILE_BYTES) {
          throw new Error('STL exceeds the 50 MB file-size safety limit.');
        }
        const buffer = await file.arrayBuffer();
        const result = importSTL(buffer, file.name, STL_SOURCE_UNIT_TO_METERS[stlSourceUnit], stlSourceUnit);
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
        const message = error instanceof Error ? error.message : String(error);
        addActivity('error', message);
        setStatus({ type: 'error', message });
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
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="rounded-lg shadow-2xl w-full max-w-lg mx-4"
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 id="import-dialog-title" className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
            {isJa ? 'インポート' : 'Import'}
          </h2>
          <button ref={closeButtonRef} onClick={onClose} className="px-3 py-1 text-sm rounded cursor-pointer" style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-secondary)' }}>
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
      </div>
    </div>
  );
}
