import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import '@fontsource-variable/inter'
import App from './App'
import { i18nReady } from './i18n'
import { ThemeProvider } from './theme/ThemeContext'
import './index.css'

// Render once the user's language is loaded so the first paint is already translated.
// If a locale fails to load, i18next falls back to English and the app renders anyway.
i18nReady.finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </MotionConfig>
      </ThemeProvider>
    </StrictMode>,
  )
})
