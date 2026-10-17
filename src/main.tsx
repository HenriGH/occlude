import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { StartupScreen } from './components/StartupScreen'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <StartupScreen error /> : this.props.children
  }
}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>)
