import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/nocturne.css'
import './styles/app.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
