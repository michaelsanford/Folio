import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The type styles' fonts, bundled with the app: no third-party requests, nothing
// blocking the first paint. Each @font-face is fetched only when the active
// type style (and the characters on screen) use it.
import '@fontsource-variable/source-sans-3'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/figtree'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
