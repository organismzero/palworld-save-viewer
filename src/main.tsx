import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted rather than loaded from a CDN: the premise of this app is that
// nothing leaves your machine, and game art from jsDelivr is the one
// deliberate, disclosed exception.
import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/martian-mono'

import { App } from './App.tsx'
import { installSessionPersistence } from './store/session.ts'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

// Outside React, and once: this subscribes to the save store and to page
// lifecycle events, neither of which belongs to a component. It writes nothing
// unless the user has opted in, and StrictMode would install it twice.
installSessionPersistence()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
