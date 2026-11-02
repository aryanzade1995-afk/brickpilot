import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  pillarName: string
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class PillarErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[Impact ErrorBoundary: ${this.props.pillarName}]`, error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-2xl border border-rose-300 bg-rose-50/50 p-6 shadow-xs dark:border-rose-900 dark:bg-rose-950/20"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-base font-bold text-rose-950 dark:text-rose-200">
                {this.props.pillarName} Unavailable
              </h3>
              <p className="mt-1 text-xs text-rose-800 dark:text-rose-300">
                An isolated render issue occurred in this pillar. Your model and other pillars remain unaffected.
              </p>
              {this.state.error?.message && (
                <p className="mt-2 font-mono text-[11px] text-rose-700 dark:text-rose-400 bg-rose-100/60 dark:bg-rose-900/40 p-2 rounded-md">
                  {this.state.error.message}
                </p>
              )}
              <button
                type="button"
                onClick={this.handleRetry}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3.5 py-2 text-xs font-semibold text-rose-900 shadow-2xs hover:bg-rose-50 transition-colors focus-visible:outline-2 focus-visible:outline-rose-600 dark:border-rose-800 dark:bg-rose-900/60 dark:text-rose-100 dark:hover:bg-rose-900 cursor-pointer min-h-[44px]"
              >
                <RotateCcw size={13} aria-hidden />
                <span>Retry {this.props.pillarName}</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

