import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/state/store';
import { readFileAsText, parseProjectFile } from '@/export/project/load';
import { importSTL } from '@/geometry/import/stl-loader';

interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportDialog({ isOpen, onClose }: ImportDialogProps) {
  const { i18n } = useTranslation();
  const isJa = i18n.language === 'ja';
  const loadProject = useAppStore((s) => s.loadProject);
  const addBody = useAppStore((s) => s.addBody);

  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  if (!isOpen) return null;

  const handleFile = async (file: File) => {
    setStatus(null);
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'json' || file.name.endsWith('.fem.json')) {
      const text = await readFileAsText(file);
      const result = parseProjectFile(text);
      if (result.success && result.data) {
        loadProject(result.data);
        setStatus({ type: 'success', message: isJa ? `プロジェクト "${result.data.meta.project_name}" を読み込みました。` : `Loaded project "${result.data.meta.project_name}".` });
        setTimeout(onClose, 1000);
      } else {
        setStatus({ type: 'error', message: result.error ?? 'Failed to load.' });
      }
    } else if (ext === 'stl') {
      const buffer = await file.arrayBuffer();
      const result = importSTL(buffer, file.name);
      if (result.success && result.body) {
        addBody(result.body);
        if (result.faces) {
          useAppStore.setState((state) => {
            state.ir.geometry.faces.push(...result.faces!);
          });
        }
        setStatus({ type: 'success', message: isJa ? `STL "${file.name}" (${result.triangleCount} 三角形) を読み込みました。` : `Imported STL "${file.name}" (${result.triangleCount} triangles).` });
      } else {
        setStatus({ type: 'error', message: result.error ?? 'STL import failed.' });
      }
    } else {
      setStatus({ type: 'error', message: isJa ? `未対応のファイル形式です: .${ext}` : `Unsupported file format: .${ext}` });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleBrowse = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.fem.json,.stl';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleFile(file);
    };
    input.click();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg shadow-2xl w-full max-w-lg mx-4"
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--color-accent)' }}>
            {isJa ? 'インポート' : 'Import'}
          </h2>
          <button onClick={onClose} className="px-3 py-1 text-sm rounded cursor-pointer" style={{ backgroundColor: 'var(--color-bg-input)', color: 'var(--color-text-secondary)' }}>
            {isJa ? '閉じる' : 'Close'}
          </button>
        </div>

        <div className="p-6">
          {/* Drop zone */}
          <div
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
              {isJa ? '対応: .fem.json, .stl' : 'Supported: .fem.json, .stl'}
            </p>
          </div>

          {/* Status */}
          {status && (
            <div className="mt-4 p-3 rounded text-sm" style={{
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
