import React, { Component, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallbackVariant?: 'chart' | 'table';
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: string | null;
    retryCount: number;
}

class ChartErrorBoundary extends Component<Props, State> {
    private retryTimeout: NodeJS.Timeout | null = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
            retryCount: 0,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return {
            hasError: true,
            error,
        };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ChartErrorBoundary caught an error:', error, errorInfo);
        this.setState({
            errorInfo: errorInfo.componentStack || null,
        });

        // Auto-retry once after 1 second for potential race condition
        if (this.state.retryCount === 0) {
            this.retryTimeout = setTimeout(() => {
                this.handleRetry();
            }, 1000);
        }
    }

    componentWillUnmount() {
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
        }
    }

    handleRetry = () => {
        this.setState(prevState => ({
            hasError: false,
            error: null,
            errorInfo: null,
            retryCount: prevState.retryCount + 1,
        }));
    };

    render() {
        if (this.state.hasError) {
            const { fallbackVariant = 'chart' } = this.props;
            const isChart = fallbackVariant === 'chart';

            return (
                <div
                    className={`flex flex-col items-center justify-center gap-4 p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 ${isChart ? 'min-h-[300px]' : 'min-h-[200px]'
                        }`}
                >
                    <div className="text-center">
                        <svg
                            className="w-12 h-12 mx-auto mb-3 text-yellow-500"
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
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                            Chart Loading Error
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            {this.state.retryCount === 0
                                ? 'Auto-retrying...'
                                : 'Unable to load chart component. This may be due to a network issue.'}
                        </p>
                        {this.state.retryCount > 0 && (
                            <button
                                onClick={this.handleRetry}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                            >
                                Try Again
                            </button>
                        )}
                    </div>
                    {process.env.NODE_ENV === 'development' && this.state.error && (
                        <details className="w-full mt-4 text-xs text-left">
                            <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                                Error Details (Dev Only)
                            </summary>
                            <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-900 rounded overflow-auto text-red-600 dark:text-red-400">
                                {this.state.error.toString()}
                                {this.state.errorInfo}
                            </pre>
                        </details>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

export default ChartErrorBoundary;
