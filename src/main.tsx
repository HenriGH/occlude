import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className="fatal-error" role="alert"><h1>Der Lernraum konnte nicht geladen werden.</h1><p>Bitte lade die Seite neu. Deine gespeicherten Daten bleiben erhalten.</p><button onClick={() => location.reload()}>Neu laden</button></div> : this.props.children
  }
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
