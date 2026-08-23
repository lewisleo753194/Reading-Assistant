/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { I18nProvider, registerLanguagePack, type LanguagePack } from './i18n'
import './styles.css'

try {
  const imported = JSON.parse(localStorage.getItem('reading-assistant-language-packs') || '[]') as LanguagePack[]
  if (Array.isArray(imported)) imported.forEach((pack) => registerLanguagePack(pack))
} catch {
  localStorage.removeItem('reading-assistant-language-packs')
}

function RootApp() {
  const [language, setLanguage] = useState(localStorage.getItem('reading-assistant-language') || 'zh-CN')
  return <I18nProvider language={language}><App onLanguageChange={setLanguage} /></I18nProvider>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><RootApp /></AppErrorBoundary>
  </StrictMode>,
)
