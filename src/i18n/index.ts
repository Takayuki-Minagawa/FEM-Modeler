import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ja } from './locales/ja';
import { en } from './locales/en';
import { phase2Ja, phase2En } from './locales/phase2';
import { diagnosticTitlesJa, diagnosticUiJa, diagnosticUiEn } from './locales/diagnostics';
import { reviewJa, reviewEn } from './locales/review';
import { workflowJa, workflowEn } from './locales/workflow';
import { bulkJa, bulkEn } from './locales/bulk';
import { selectionEditingJa, selectionEditingEn } from './locales/selection-editing';
import { geometryEditorJa, geometryEditorEn } from './locales/geometry-editor';
import { viewerControlsJa, viewerControlsEn } from './locales/viewer-controls';
import { asyncOperationJa, asyncOperationEn } from './locales/async-operation';

const savedLang = typeof window !== 'undefined'
  ? localStorage.getItem('fem-modeler-lang') ?? 'ja'
  : 'ja';

i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: { ...ja, ...phase2Ja, review: reviewJa, workflow: workflowJa, bulk: bulkJa, selectionEditing: selectionEditingJa, geometryEditor: geometryEditorJa, viewerControls: viewerControlsJa, asyncOperation: asyncOperationJa, diagnosticTitles: diagnosticTitlesJa, diagnosticUi: diagnosticUiJa } },
    en: { translation: { ...en, ...phase2En, review: reviewEn, workflow: workflowEn, bulk: bulkEn, selectionEditing: selectionEditingEn, geometryEditor: geometryEditorEn, viewerControls: viewerControlsEn, asyncOperation: asyncOperationEn, diagnosticTitles: {}, diagnosticUi: diagnosticUiEn } },
  },
  lng: savedLang,
  fallbackLng: 'ja',
  interpolation: { escapeValue: false },
});

export default i18n;
