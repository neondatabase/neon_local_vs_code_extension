import { useEffect, useRef } from 'react';

/**
 * Custom hook to automatically scroll to an error banner when an error occurs
 * @param error - The error message (scrolls when this changes to a non-empty value)
 * @returns A ref to attach to the error element
 */
export function useScrollToError(error: string) {
    const errorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (error && errorRef.current) {
            // Small delay to ensure the error banner is rendered
            setTimeout(() => {
                errorRef.current?.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'nearest'
                });
            }, 100);
        }
    }, [error]);

    return errorRef;
}


