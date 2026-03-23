import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ja } from './locales/ja';
import { en } from './locales/en';
import { phase2Ja, phase2En } from './locales/phase2';

const savedLang = typeof window !== 'undefined'
  ? localStorage.getItem('fem-modeler-lang') ?? 'ja'
  : 'ja';

i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: { ...ja, ...phase2Ja } },
    en: { translation: { ...en, ...phase2En } },
  },
  lng: savedLang,
  fallbackLng: 'ja',
  interpolation: { escapeValue: false },
});

export default i18n;
