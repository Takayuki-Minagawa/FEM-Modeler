import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ja } from './locales/ja';
import { en } from './locales/en';

const savedLang = typeof window !== 'undefined'
  ? localStorage.getItem('fem-modeler-lang') ?? 'ja'
  : 'ja';

i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'ja',
  interpolation: { escapeValue: false },
});

export default i18n;
