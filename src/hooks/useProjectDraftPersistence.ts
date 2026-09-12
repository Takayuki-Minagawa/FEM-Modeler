import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadProjectFile } from '@/export/project/save';
import { useAppStore } from '@/state/store';
import { clearProjectDraft, DraftConflictError, estimateProjectDraftBytes, getProjectDraftSummary,
  listProjectDrafts, listProjectDraftVersions, loadProjectDraft, saveProjectDraft, type DraftSummary } from '@/lib/project-draft-storage';
import { generateId } from '@/core/ir/id-generator';
import type { ActivityLogEntry, ActivityLogLevel, DraftPersistenceState } from '@/contexts/app-context-value';

export type PersistenceReadiness = 'initializing' | 'awaiting_restore' | 'editing';
export function computeAutosaveDelay(ir: Parameters<typeof estimateProjectDraftBytes>[0]): number {
  const size = estimateProjectDraftBytes(ir);
  return Math.round(1200 + Math.min(Math.max((size - 200_000) / 200_000, 0), 1) * 3800);
}

export function useProjectDraftPersistence() {
  const { i18n } = useTranslation();
  const language = useRef(i18n.language);
  useEffect(() => { language.current = i18n.language; }, [i18n.language]);
  const ir = useAppStore((s) => s.ir);
  const session = useAppStore((s) => s.projectSession);
  const [resolvedReadiness, setReadiness] = useState<PersistenceReadiness>('initializing');
  const [readySession, setReadySession] = useState(-1);
  const readiness = readySession === session ? resolvedReadiness : 'initializing';
  const [recentProjects, setRecentProjects] = useState<DraftSummary[]>([]);
  const [draftSummary, setDraftSummary] = useState<DraftSummary | null>(null);
  const [autosaveState, setAutosaveState] = useState<DraftPersistenceState>({ status: 'idle', lastSavedAt: null, errorMessage: null });
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const generation = useRef(0);
  const expectedVersion = useRef<{ value: string | null }>({ value: null });
  const lastSavedIR = useRef<typeof ir | null>(null);
  const pendingRestore = useRef<{ projectId: string; versionId: string | null } | null>(null);
  const sessionReady = useRef(-1);
  const paused = useRef(false);
  const addActivity = useCallback((level: ActivityLogLevel, message: string) => {
    setActivityLog((entries) => [{ id: generateId('log'), timestamp: new Date().toISOString(), level, message }, ...entries].slice(0, 60));
  }, []);
  const clearActivityLog = useCallback(() => setActivityLog([]), []);
  const reportError = useCallback((error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);
    const message = language.current !== 'ja' ? raw
      : error instanceof DraftConflictError ? '別のタブでこのプロジェクトが保存されました。最新世代を復元するか、現在の作業をファイルに保存してください。'
      : error instanceof DOMException && error.name === 'QuotaExceededError' ? 'ブラウザーの保存容量が不足しています。古いプロジェクトをファイルに保存してから削除してください。'
      : raw.startsWith('Draft storage exceeds') ? '自動保存の容量上限（128 MiB）を超えました。古いプロジェクトをファイルに保存してから削除してください。'
      : raw.startsWith('IndexedDB is unavailable') ? 'この環境ではブラウザーへの自動保存を利用できません。プロジェクトをファイルに保存してください。'
      : raw;
    setAutosaveState((current) => ({ status: error instanceof DraftConflictError ? 'conflict' : 'error', lastSavedAt: current.lastSavedAt, errorMessage: message }));
    addActivity('error', language.current === 'ja' ? `自動保存: ${message}` : `Auto-save: ${message}`);
  }, [addActivity]);

  const flushCurrentDraft = useCallback(async () => {
    const current = useAppStore.getState();
    if (current.projectSession < 1 || sessionReady.current !== current.projectSession || paused.current || lastSavedIR.current === current.ir) return;
    generation.current += 1;
    const versionToken = expectedVersion.current;
    const summary = await saveProjectDraft(current.ir, undefined, { getExpectedVersion: () => versionToken.value });
    versionToken.value = summary.versionId;
    lastSavedIR.current = current.ir;
  }, []);

  // Switching projects commits pending edits of the previous project. The next
  // initialization waits for the same storage queue before reading project heads.
  useEffect(() => useAppStore.subscribe((next, previous) => {
    if (next.projectSession === previous.projectSession || previous.projectSession < 1
      || sessionReady.current !== previous.projectSession || paused.current || lastSavedIR.current === previous.ir) return;
    generation.current += 1;
    const versionToken = expectedVersion.current;
    void saveProjectDraft(previous.ir, undefined, { getExpectedVersion: () => versionToken.value }).then((summary) => {
      versionToken.value = summary.versionId;
      lastSavedIR.current = previous.ir;
      setRecentProjects((projects) => [summary, ...projects.filter((project) => project.projectId !== summary.projectId)]);
    }).catch(reportError);
  }), [reportError]);

  useEffect(() => {
    let ignore = false;
    generation.current += 1;
    sessionReady.current = -1;
    paused.current = false;
    const currentIr = useAppStore.getState().ir;
    void listProjectDrafts().then((projects) => {
      if (ignore) return;
      setRecentProjects(projects);
      const summary = session > 0 ? projects.find((project) => project.projectId === currentIr.meta.project_id) ?? null : projects[0] ?? null;
      const restoring = pendingRestore.current;
      expectedVersion.current = { value: restoring?.projectId === currentIr.meta.project_id ? restoring.versionId : summary?.versionId ?? null };
      pendingRestore.current = null;
      setDraftSummary(summary);
      setAutosaveState({ status: summary ? 'saved' : 'idle', lastSavedAt: summary?.savedAt ?? null, errorMessage: null });
      sessionReady.current = session;
      setReadySession(session);
      setReadiness(session > 0 ? 'editing' : 'awaiting_restore');
    }).catch((error) => { if (!ignore) { reportError(error); setReadySession(session); setReadiness('awaiting_restore'); } });
    return () => { ignore = true; generation.current += 1; };
  }, [session, reportError]);

  useEffect(() => {
    if (readiness !== 'editing' || sessionReady.current !== session || paused.current || lastSavedIR.current === ir) return;
    const editGeneration = ++generation.current;
    const versionToken = expectedVersion.current;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled || paused.current || generation.current !== editGeneration) return;
      setAutosaveState((current) => ({ ...current, status: 'saving', errorMessage: null }));
      // A queued save reads its expected version when dispatched. A previous save may
      // already have committed while this edit was waiting for its debounce timer.
      const expected = versionToken.value;
      void saveProjectDraft(ir, new Date().toISOString(), { expectedVersion: expected, getExpectedVersion: () => versionToken.value,
        shouldSave: () => !cancelled && !paused.current && generation.current === editGeneration,
      }).then((summary) => {
        // An already committed write must advance the token even if the next edit arrived.
        versionToken.value = summary.versionId;
        lastSavedIR.current = ir;
        if (cancelled) return;
        setDraftSummary(summary);
        setRecentProjects((projects) => [summary, ...projects.filter((project) => project.projectId !== summary.projectId)]);
        setAutosaveState({ status: 'saved', lastSavedAt: summary.savedAt, errorMessage: null });
      }).catch((error) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (error instanceof DraftConflictError) { paused.current = true; generation.current += 1; }
        reportError(error);
      });
    }, computeAutosaveDelay(ir));
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ir, readiness, session, reportError]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('fem-modeler-drafts');
    channel.onmessage = (event: MessageEvent<DraftSummary>) => {
      const summary = event.data;
      if (!summary || typeof summary.projectId !== 'string' || typeof summary.versionId !== 'string') return;
      setRecentProjects((projects) => [summary, ...projects.filter((project) => project.projectId !== summary.projectId)]);
      if (sessionReady.current > 0 && useAppStore.getState().ir.meta.project_id === summary.projectId && expectedVersion.current.value !== summary.versionId) {
        paused.current = true;
        generation.current += 1;
        reportError(new DraftConflictError());
      }
    };
    return () => channel.close();
  }, [reportError]);

  const saveProjectFile = useCallback(() => {
    const current = useAppStore.getState().ir;
    downloadProjectFile(current);
    addActivity('success', language.current === 'ja' ? `プロジェクト "${current.meta.project_name}" を保存しました。` : `Saved project "${current.meta.project_name}".`);
  }, [addActivity]);

  const restoreDraft = useCallback(async (projectId?: string, versionId?: string) => {
    try {
      await flushCurrentDraft();
      paused.current = true;
      generation.current += 1;
      const summary = await getProjectDraftSummary(projectId);
      if (!summary) { addActivity('warning', language.current === 'ja' ? '復元できる保存データはありません。' : 'No saved draft is available.'); return false; }
      const draft = await loadProjectDraft(summary.projectId, versionId);
      if (!draft) return false;
      pendingRestore.current = { projectId: draft.meta.project_id, versionId: summary.versionId };
      lastSavedIR.current = versionId ? null : draft;
      useAppStore.getState().loadProject(draft);
      addActivity('success', language.current === 'ja' ? `"${draft.meta.project_name}" を復元しました。` : `Restored "${draft.meta.project_name}".`);
      return true;
    } catch (error) { reportError(error); return false; }
  }, [addActivity, reportError, flushCurrentDraft]);

  const discardDraft = useCallback(async (projectId?: string) => {
    const id = projectId ?? draftSummary?.projectId;
    if (!id) return;
    const isCurrent = useAppStore.getState().ir.meta.project_id === id;
    if (isCurrent) { paused.current = true; generation.current += 1; }
    try {
      await clearProjectDraft(id);
      const projects = await listProjectDrafts();
      setRecentProjects(projects);
      const active = useAppStore.getState();
      setDraftSummary(active.projectSession > 0 ? projects.find((project) => project.projectId === active.ir.meta.project_id) ?? null : projects[0] ?? null);
      if (isCurrent) {
        expectedVersion.current.value = null; lastSavedIR.current = active.ir; paused.current = false;
        setAutosaveState({ status: 'idle', lastSavedAt: null, errorMessage: null });
      }
      addActivity('warning', language.current === 'ja' ? '保存データを削除しました。' : 'Deleted the saved project.');
    } catch (error) { reportError(error); }
  }, [draftSummary, addActivity, reportError]);

  return useMemo(() => ({ readiness, recentProjects, draftSummary, autosaveState, activityLog, addActivity, clearActivityLog,
    saveProjectFile, restoreDraft, discardDraft, listDraftVersions: listProjectDraftVersions }),
  [readiness, recentProjects, draftSummary, autosaveState, activityLog, addActivity, clearActivityLog, saveProjectFile, restoreDraft, discardDraft]);
}
