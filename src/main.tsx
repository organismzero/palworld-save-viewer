import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted rather than loaded from a CDN: the premise of this app is that
// nothing leaves your machine, and game art from jsDelivr is the one
// deliberate, disclosed exception.
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/martian-mono'

import { App } from './App.tsx'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
