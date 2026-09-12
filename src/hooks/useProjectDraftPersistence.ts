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
  const [saveAttempt, setSaveAttempt] = useState(0);
  const readiness = readySession === session ? resolvedReadiness : 'initializing';
  const [recentProjects, setRecentProjects] = useState<DraftSummary[]>([]);
  const [draftSummary, setDraftSummary] = useState<DraftSummary | null>(null);
  const [autosaveState, setAutosaveState] = useState<DraftPersistenceState>({ status: 'idle', lastSavedAt: null, errorMessage: null });
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const generation = useRef(0);
  const expectedVersion = useRef<{ value: string | null }>({ value: null });
  const lastSavedIR = useRef<typeof ir | null>(null);
  const lastDownloadedIR = useRef<typeof ir | null>(null);
  const pendingRestore = useRef<{ projectId: string; versionId: string | null } | null>(null);
  const sessionReady = useRef(-1);
  const paused = useRef(false);
  const conflictPaused = useRef(false);
  const operationSequence = useRef(0);
  const addActivity = useCallback((level: ActivityLogLevel, message: string) => {
    setActivityLog((entries) => [{ id: generateId('log'), timestamp: new Date().toISOString(), level, message }, ...entries].slice(0, 60));
  }, []);
  const clearActivityLog = useCallback(() => setActivityLog([]), []);
  const reportError = useCallback((error: unknown) => {
    if (error instanceof DraftConflictError) {
      conflictPaused.current = true; paused.current = true; generation.current += 1;
    }
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
    if (current.projectSession < 1 || sessionReady.current !== current.projectSession || paused.current
      || (lastSavedIR.current === current.ir && expectedVersion.current.value !== null)) return;
    generation.current += 1;
    const versionToken = expectedVersion.current;
    const summary = await saveProjectDraft(current.ir, undefined, { getExpectedVersion: () => versionToken.value });
    versionToken.value = summary.versionId;
    lastSavedIR.current = current.ir;
  }, []);

  // UI replacements must preserve the current snapshot before resetting the
  // store/history. A subscription after replacement cannot recover a failed save.
  const transitionProject = useCallback(async (replace: () => void) => {
    const original = useAppStore.getState();
    const operation = ++operationSequence.current;
    let replaced = false;
    try {
      const backedUp = lastDownloadedIR.current === original.ir
        || (lastSavedIR.current === original.ir && expectedVersion.current.value !== null);
      if (original.projectSession > 0 && !backedUp) {
        if (sessionReady.current !== original.projectSession) throw new Error(language.current === 'ja'
          ? '保存データの確認が完了してから再度お試しください。' : 'Please wait until saved projects have been checked and try again.');
        if (conflictPaused.current) throw new DraftConflictError();
        if (paused.current) throw new Error(language.current === 'ja'
          ? '保存が一時停止しています。保存の競合または復元処理を解決してください。' : 'Saving is paused. Resolve the save conflict or pending restoration first.');
      }
      if (!backedUp) await flushCurrentDraft();
      const latest = useAppStore.getState();
      if (operation !== operationSequence.current || latest.projectSession !== original.projectSession || latest.ir !== original.ir) {
        throw new Error(language.current === 'ja' ? '保存中に編集内容が変わりました。再度お試しください。' : 'The project changed while saving. Please try again.');
      }
      replace();
      replaced = true;
      return { success: true };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const error = language.current === 'ja'
        ? `プロジェクトの切替を中止しました。現在の編集内容は保持されています。${detail} 保存を再試行するか、現在のプロジェクトをファイルに保存してから再度切り替えてください。`
        : `Project switch cancelled. Your current edits have been kept. ${detail} Retry saving, or save the current project to a file before switching again.`;
      if (operation === operationSequence.current) {
        reportError(cause);
      }
      return { success: false, error };
    } finally {
      if (!replaced && operation === operationSequence.current && useAppStore.getState().projectSession === original.projectSession) {
        // A superseded restore/discard no longer owns its cleanup. Release its
        // temporary pause here, while retaining an actual multi-tab conflict.
        paused.current = conflictPaused.current;
        setSaveAttempt((attempt) => attempt + 1);
      }
    }
  }, [flushCurrentDraft, reportError]);

  // Switching projects commits pending edits of the previous project. The next
  // initialization waits for the same storage queue before reading project heads.
  useEffect(() => useAppStore.subscribe((next, previous) => {
    if (next.projectSession === previous.projectSession || previous.projectSession < 1
      || sessionReady.current !== previous.projectSession || paused.current || lastSavedIR.current === previous.ir
      || lastDownloadedIR.current === previous.ir) return;
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
    conflictPaused.current = false;
    operationSequence.current += 1;
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
        reportError(error);
      });
    }, computeAutosaveDelay(ir));
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ir, readiness, session, reportError, saveAttempt]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('fem-modeler-drafts');
    channel.onmessage = (event: MessageEvent<DraftSummary>) => {
      const summary = event.data;
      if (!summary || typeof summary.projectId !== 'string' || typeof summary.versionId !== 'string') return;
      setRecentProjects((projects) => [summary, ...projects.filter((project) => project.projectId !== summary.projectId)]);
      if (sessionReady.current > 0 && useAppStore.getState().ir.meta.project_id === summary.projectId && expectedVersion.current.value !== summary.versionId) {
        reportError(new DraftConflictError());
      }
    };
    return () => channel.close();
  }, [reportError]);

  const saveProjectFile = useCallback(() => {
    const current = useAppStore.getState().ir;
    downloadProjectFile(current);
    lastDownloadedIR.current = current;
    addActivity('success', language.current === 'ja' ? `プロジェクト "${current.meta.project_name}" を保存しました。` : `Saved project "${current.meta.project_name}".`);
  }, [addActivity]);

  const restoreDraft = useCallback(async (projectId?: string, versionId?: string) => {
    const operation = ++operationSequence.current;
    const original = useAppStore.getState();
    let restored = false;
    const ensureUnchanged = () => {
      const latest = useAppStore.getState();
      if (operation !== operationSequence.current || latest.projectSession !== original.projectSession || latest.ir !== original.ir) {
        throw new Error(language.current === 'ja' ? '復元中に現在の編集内容が変わりました。復元を取り消しました。' : 'The current project changed during restoration. Restoration was cancelled.');
      }
    };
    try {
      const anotherProject = original.projectSession > 0 && projectId && projectId !== original.ir.meta.project_id;
      const backedUp = lastDownloadedIR.current === original.ir
        || (lastSavedIR.current === original.ir && expectedVersion.current.value !== null);
      if (anotherProject && !backedUp && (paused.current || sessionReady.current !== original.projectSession)) {
        throw new Error(language.current === 'ja'
          ? '現在の編集内容を保存できません。別プロジェクトへ切り替える前にファイルに保存してください。'
          : 'Current edits cannot be saved. Save the current project to a file before switching to another project.');
      }
      if (!backedUp) await flushCurrentDraft();
      ensureUnchanged();
      paused.current = true;
      generation.current += 1;
      const summary = await getProjectDraftSummary(projectId ?? (original.projectSession > 0 ? original.ir.meta.project_id : undefined));
      ensureUnchanged();
      if (!summary) { addActivity('warning', language.current === 'ja' ? '復元できる保存データはありません。' : 'No saved draft is available.'); return false; }
      const draft = await loadProjectDraft(summary.projectId, versionId);
      ensureUnchanged();
      if (!draft) throw new Error(language.current === 'ja' ? '選択した保存世代はありません。' : 'The selected saved version is no longer available.');
      pendingRestore.current = { projectId: draft.meta.project_id, versionId: summary.versionId };
      lastSavedIR.current = versionId ? null : draft;
      useAppStore.getState().loadProject(draft);
      restored = true;
      addActivity('success', language.current === 'ja' ? `"${draft.meta.project_name}" を復元しました。` : `Restored "${draft.meta.project_name}".`);
      return true;
    } catch (error) {
      if (operation === operationSequence.current) reportError(error);
      return false;
    } finally {
      if (!restored && operation === operationSequence.current && useAppStore.getState().projectSession === original.projectSession) {
        paused.current = conflictPaused.current;
        setSaveAttempt((attempt) => attempt + 1);
      }
    }
  }, [addActivity, reportError, flushCurrentDraft]);

  const discardDraft = useCallback(async (projectId?: string) => {
    const id = projectId ?? draftSummary?.projectId;
    if (!id) return;
    const isCurrent = useAppStore.getState().ir.meta.project_id === id;
    const originalSession = useAppStore.getState().projectSession;
    const originalIR = useAppStore.getState().ir;
    const operation = isCurrent ? ++operationSequence.current : operationSequence.current;
    if (isCurrent) { paused.current = true; generation.current += 1; }
    try {
      await clearProjectDraft(id);
      const projects = await listProjectDrafts();
      setRecentProjects(projects);
      const active = useAppStore.getState();
      setDraftSummary(active.projectSession > 0 ? projects.find((project) => project.projectId === active.ir.meta.project_id) ?? null : projects[0] ?? null);
      if (isCurrent && operation === operationSequence.current && active.projectSession === originalSession) {
        // Only the snapshot covered by the deletion is intentionally unsaved.
        // Edits made while IndexedDB was busy must resume autosaving afterwards.
        expectedVersion.current.value = null; lastSavedIR.current = originalIR; paused.current = false;
        setAutosaveState({ status: 'idle', lastSavedAt: null, errorMessage: null });
      }
      addActivity('warning', language.current === 'ja' ? '保存データを削除しました。' : 'Deleted the saved project.');
    } catch (error) { reportError(error); }
    finally {
      if (isCurrent && operation === operationSequence.current && useAppStore.getState().projectSession === originalSession) {
        paused.current = conflictPaused.current;
        setSaveAttempt((attempt) => attempt + 1);
      }
    }
  }, [draftSummary, addActivity, reportError]);

  return useMemo(() => ({ readiness, recentProjects, draftSummary, autosaveState, activityLog, addActivity, clearActivityLog,
    saveProjectFile, transitionProject, restoreDraft, discardDraft, listDraftVersions: listProjectDraftVersions }),
  [readiness, recentProjects, draftSummary, autosaveState, activityLog, addActivity, clearActivityLog, saveProjectFile, transitionProject, restoreDraft, discardDraft]);
}
