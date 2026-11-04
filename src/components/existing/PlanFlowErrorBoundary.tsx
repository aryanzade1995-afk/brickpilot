import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button.tsx'

interface Props {
  stepName?: string
  children: ReactNode
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class PlanFlowErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`[PlanFlowErrorBoundary: ${this.props.stepName || 'Flow'}]`, error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-2xl border border-rose-300 bg-rose-50/70 p-6 shadow-sm dark:border-rose-900 dark:bg-rose-950/20 my-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-base font-bold text-rose-950 dark:text-rose-200">
                {this.props.stepName ? `${this.props.stepName} Encountered an Issue` : 'Unexpected Plan Error'}
              </h3>
              <p className="mt-1 text-xs text-rose-800 dark:text-rose-300 leading-relaxed">
                We encountered an issue processing this stage of your floor plan. Your image and project settings are preserved.
              </p>
              {this.state.error?.message && (
                <p className="mt-3 font-mono text-[11px] text-rose-700 dark:text-rose-400 bg-rose-100/70 dark:bg-rose-900/40 p-2.5 rounded-lg border border-rose-200 dark:border-rose-800/50 overflow-x-auto">
                  {this.state.error.message}
                </p>
              )}
              <div className="mt-4 flex items-center gap-3">
                <Button size="sm" onClick={this.handleRetry}>
                  <RotateCcw size={14} />
                  <span>Retry This Step</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

