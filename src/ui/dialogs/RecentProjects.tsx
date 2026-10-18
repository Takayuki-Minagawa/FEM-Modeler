import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '@/hooks/useAppContext';
import type { DraftSummary } from '@/lib/project-draft-storage';

export function RecentProjects() {
  const { i18n } = useTranslation();
  const ja = i18n.language === 'ja';
  const { recentProjects, restoreDraft, discardDraft, renameDraft, listDraftVersions, readiness } = useAppContext();
  const [versions, setVersions] = useState<Record<string, DraftSummary[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ projectId: string; versionId: string; name: string } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [message, setMessage] = useState('');
  if (readiness === 'initializing') return <p role="status">{ja ? '保存データを確認しています…' : 'Checking saved projects…'}</p>;
  if (!recentProjects.length) return null;
  return <section className="mb-5 space-y-2" aria-label={ja ? '最近のプロジェクト' : 'Recent projects'}>
    <h2 className="font-bold text-sm">{ja ? '最近のプロジェクト・保存世代' : 'Recent projects and saved versions'}</h2>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status" className="text-xs">{message}</p>}
    {recentProjects.map((project) => <div key={project.projectId} className="border rounded p-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={renaming} className="text-sm underline cursor-pointer" onClick={() => void restoreDraft(project.projectId)}>{project.projectName}</button>
        <time className="text-xs" dateTime={project.savedAt}>{new Date(project.savedAt).toLocaleString(ja ? 'ja-JP' : 'en-US')}</time>
        <button disabled={renaming} className="text-xs underline cursor-pointer" aria-label={ja ? `「${project.projectName}」を改名（${project.projectId}）` : `Rename ${project.projectName} (${project.projectId})`} onClick={() => {
          setEditing({ projectId: project.projectId, versionId: project.versionId, name: project.projectName }); setError(null); setMessage('');
        }}>{ja ? '改名' : 'Rename'}</button>
        <button disabled={renaming} aria-label={ja ? `「${project.projectName}」の以前の世代（${project.projectId}）` : `Previous versions of ${project.projectName} (${project.projectId})`} className="text-xs underline cursor-pointer" onClick={() => {
          void listDraftVersions(project.projectId).then((items) => { setVersions((current) => ({ ...current, [project.projectId]: items })); setError(null); }).catch((cause) => setError(String(cause)));
        }}>{ja ? '以前の世代' : 'Previous versions'}</button>
        <button disabled={renaming} aria-label={ja ? `「${project.projectName}」を削除（${project.projectId}）` : `Delete ${project.projectName} (${project.projectId})`} className="text-xs underline cursor-pointer" onClick={() => {
          if (confirm(ja ? `「${project.projectName}」の保存世代を全て削除しますか？` : `Delete all saved versions of "${project.projectName}"?`)) void discardDraft(project.projectId);
        }}>{ja ? '削除' : 'Delete'}</button>
      </div>
      {editing?.projectId === project.projectId && <form className="mt-2 space-y-2" onSubmit={(event) => {
        event.preventDefault();
        if (!editing.name.trim() || renaming) return;
        setRenaming(true); setError(null); setMessage('');
        void renameDraft(project.projectId, editing.name, editing.versionId).then(async (response) => {
          if (!response.success) { setError(response.error ?? (ja ? '改名に失敗しました。' : 'Rename failed.')); return; }
          setEditing(null);
          setMessage(ja ? '名前を保存しました。以前の名前は保存世代に残ります。' : 'Name saved. Earlier names remain in saved versions.');
          if (versions[project.projectId]) {
            const items = await listDraftVersions(project.projectId);
            setVersions((current) => ({ ...current, [project.projectId]: items }));
          }
        }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setRenaming(false));
      }}>
        <label className="block text-xs" htmlFor={`recent-name-${project.projectId}`}>{ja ? '保存プロジェクト名' : 'Saved project name'}</label>
        <input id={`recent-name-${project.projectId}`} className="w-full rounded px-2 py-1 text-sm" style={{ backgroundColor: 'var(--color-bg-input)' }} disabled={renaming} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
        <div className="flex gap-3 text-xs">
          <button type="submit" disabled={renaming || !editing.name.trim()}>{renaming ? (ja ? '保存中…' : 'Saving…') : (ja ? '名前を保存' : 'Save name')}</button>
          <button type="button" disabled={renaming} onClick={() => { setEditing(null); setError(null); }}>{ja ? '取消' : 'Cancel'}</button>
        </div>
      </form>}
      {versions[project.projectId]?.length === 0 && <p className="text-xs mt-2">{ja ? '以前の世代はありません。' : 'No earlier versions.'}</p>}
      {versions[project.projectId]?.map((version) => <div key={version.versionId} className="text-xs mt-2">
        <button disabled={renaming} className="underline cursor-pointer" onClick={() => void restoreDraft(project.projectId, version.versionId)}>
          {ja ? 'この世代を復元: ' : 'Restore version: '}{version.projectName} · {new Date(version.savedAt).toLocaleString(ja ? 'ja-JP' : 'en-US')}
        </button>
      </div>)}
    </div>)}
  </section>;
}
