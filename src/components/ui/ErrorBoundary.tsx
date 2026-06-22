import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary Component
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(_error: Error): Partial<State> {
        // Update state so the next render will show the fallback UI
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Log error details for debugging
        console.error('Error Boundary caught an error:', error, errorInfo);

        // You can also log the error to an error reporting service here
        // logErrorToService(error, errorInfo);

        this.setState({
            error,
            errorInfo
        });
    }

    private handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });
        // Reload the page to reset the app state
        window.location.reload();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // Fallback UI
            return (
                <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-200 dark:border-gray-700">
                        <div className="flex flex-col items-center text-center">
                            {/* Error Icon */}
                            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4">
                                <svg
                                    className="w-8 h-8 text-red-600 dark:text-red-400"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                    />
                                </svg>
                            </div>

                            {/* Error Message */}
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                                Oops! Something went wrong
                            </h1>
                            <p className="text-gray-600 dark:text-gray-400 mb-6">
                                The application encountered an unexpected error. Please try reloading the page.
                            </p>

                            {/* Error Details (Development Mode) */}
                            {process.env.NODE_ENV === 'development' && this.state.error && (
                                <details className="w-full mb-6 text-left">
                                    <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        Error Details (Dev Mode)
                                    </summary>
                                    <div className="bg-gray-100 dark:bg-gray-900 rounded p-4 overflow-auto max-h-48">
                                        <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">
                                            {this.state.error.toString()}
                                            {this.state.errorInfo && `\n\n${this.state.errorInfo.componentStack}`}
                                        </pre>
                                    </div>
                                </details>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-3 w-full">
                                <button
                                    onClick={this.handleReset}
                                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                >
                                    Reload Page
                                </button>
                                <button
                                    onClick={() => window.history.back()}
                                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                                >
                                    Go Back
                                </button>
                            </div>

                            {/* Help Text */}
                            <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
                                If the problem persists, please contact support or clear your browser cache.
                            </p>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
