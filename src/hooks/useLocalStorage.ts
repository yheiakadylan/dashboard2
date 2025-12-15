import { useState } from 'react';

/**
 * A custom hook for managing state synchronized with localStorage.
 * 
 * @param key The key to store the data under in localStorage.
 * @param initialValue The initial value to use if no value is found in localStorage.
 * @returns A tuple containing the stored value and a setter function.
 */
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
    // State to store our value
    // Pass initial state function to useState so logic is only executed once
    const [storedValue, setStoredValue] = useState<T>(() => {
        if (typeof window === "undefined") {
            return initialValue;
        }
        try {
            const item = window.localStorage.getItem(key);
            // Parse stored json or if none return initialValue
            if (!item) return initialValue;

            try {
                return JSON.parse(item);
            } catch (jsonError) {
                // If parsing fails, it might be a raw string from previous versions
                // If initialValue is a string, we can safely return the raw item
                if (typeof initialValue === 'string') {
                    // Safe: we already verified initialValue is string type
                    return item as T;
                }
                console.error(`Error reading localStorage key "${key}":`, jsonError);
                return initialValue;
            }
        } catch (error) {
            // General error (e.g. access denied)
            console.error(`Error accessing localStorage key "${key}":`, error);
            return initialValue;
        }

    });

    // Return a wrapped version of useState's setter function that ...
    // ... persists the new value to localStorage.
    const setValue = (value: T | ((val: T) => T)) => {
        try {
            // Allow value to be a function so we have same API as useState
            const valueToStore =
                value instanceof Function ? value(storedValue) : value;

            // Save state
            setStoredValue(valueToStore);

            // Save to local storage
            if (typeof window !== "undefined") {
                window.localStorage.setItem(key, JSON.stringify(valueToStore));
            }
        } catch (error) {
            // A more advanced implementation would handle the error case
            console.error(`Error description localStorage key "${key}":`, error);
        }
    };

    return [storedValue, setValue];
}

export default useLocalStorage;
