import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.tsx'
import { installSessionPersistence } from './store/session.ts'
// Pulls in `fonts/fonts.css`, which declares the two self-hosted families. They
// are vendored rather than fetched from a CDN or installed as a package: the
// premise of this app is that nothing leaves your machine, and game art from
// jsDelivr is the one deliberate, disclosed exception.
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
