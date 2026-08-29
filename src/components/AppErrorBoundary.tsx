import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

type Props = { children: ReactNode }
type State = { error: string }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: '' }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : '发生未知错误' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Raid UI error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error">
          <AlertTriangle size={28} />
          <h1>页面遇到一个问题</h1>
          <p>{this.state.error}</p>
          <button onClick={() => window.location.reload()}><RotateCcw size={16} /> 重新加载</button>
        </main>
      )
    }
    return this.props.children
  }
}
