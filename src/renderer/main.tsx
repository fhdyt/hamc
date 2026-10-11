import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrap } from './bootstrap'
import './styles/index.css'

void bootstrap()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
