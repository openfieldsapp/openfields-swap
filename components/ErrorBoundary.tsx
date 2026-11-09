import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

/** The whole page in one sentence and one button when something breaks; the reason is there for whoever wants it. */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className='of-crash' role='alert'>
          <h1 className='of-crash-title'>Something went wrong.</h1>
          <p className='of-note'>Reload the page to start again.</p>
          <button type='button' className='of-btn of-btn--primary' onClick={() => window.location.reload()}>Reload</button>
          {this.state.error?.message && (
            <details className='of-disclosure'>
              <summary>Details</summary>
              <pre className='of-code'>{this.state.error.message}</pre>
            </details>
          )}
        </section>
      )
    }

    return this.props.children
  }
}
