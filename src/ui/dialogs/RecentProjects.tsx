import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '@/hooks/useAppContext';
import type { DraftSummary } from '@/lib/project-draft-storage';

export function RecentProjects() {
  const { i18n } = useTranslation();
  const ja = i18n.language === 'ja';
  const { recentProjects, restoreDraft, discardDraft, listDraftVersions, readiness } = useAppContext();
  const [versions, setVersions] = useState<Record<string, DraftSummary[]>>({});
  const [error, setError] = useState<string | null>(null);
  if (readiness === 'initializing') return <p role="status">{ja ? '保存データを確認しています…' : 'Checking saved projects…'}</p>;
  if (!recentProjects.length) return null;
  return <section className="mb-5 space-y-2" aria-label={ja ? '最近のプロジェクト' : 'Recent projects'}>
    <h2 className="font-bold text-sm">{ja ? '最近のプロジェクト・保存世代' : 'Recent projects and saved versions'}</h2>
    {error && <p role="alert">{error}</p>}
    {recentProjects.map((project) => <div key={project.projectId} className="border rounded p-3" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <button className="text-sm underline cursor-pointer" onClick={() => void restoreDraft(project.projectId)}>{project.projectName}</button>
        <time className="text-xs" dateTime={project.savedAt}>{new Date(project.savedAt).toLocaleString(ja ? 'ja-JP' : 'en-US')}</time>
        <button className="text-xs underline cursor-pointer" onClick={() => {
          void listDraftVersions(project.projectId).then((items) => { setVersions((current) => ({ ...current, [project.projectId]: items })); setError(null); }).catch((cause) => setError(String(cause)));
        }}>{ja ? '以前の世代' : 'Previous versions'}</button>
        <button className="text-xs underline cursor-pointer" onClick={() => {
          if (confirm(ja ? `「${project.projectName}」の保存世代を全て削除しますか？` : `Delete all saved versions of "${project.projectName}"?`)) void discardDraft(project.projectId);
        }}>{ja ? '削除' : 'Delete'}</button>
      </div>
      {versions[project.projectId]?.length === 0 && <p className="text-xs mt-2">{ja ? '以前の世代はありません。' : 'No earlier versions.'}</p>}
      {versions[project.projectId]?.map((version) => <div key={version.versionId} className="text-xs mt-2">
        <button className="underline cursor-pointer" onClick={() => void restoreDraft(project.projectId, version.versionId)}>
          {ja ? 'この世代を復元: ' : 'Restore version: '}{new Date(version.savedAt).toLocaleString(ja ? 'ja-JP' : 'en-US')}
        </button>
      </div>)}
    </div>)}
  </section>;
}
