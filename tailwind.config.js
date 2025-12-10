/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                'gray-900': '#111827',
                'gray-800': '#1f2937',
                'gray-700': '#374151',
                'gray-600': '#4b5563',
                'gray-500': '#6b7280',
                'blue-500': '#3b82f6',
                'blue-600': '#2563eb',
            },
        }
    },
    plugins: [],
}
