import React from 'react';
import { spacing } from '../../design-system';

interface MultiSelectCheckboxProps {
    label: string;
    options: Array<{ value: string; label: string }>;
    selectedValues: string[];
    onChange: (selectedValues: string[]) => void;
    helperText?: string;
    disabled?: boolean;
}

export const MultiSelectCheckbox: React.FC<MultiSelectCheckboxProps> = ({
    label,
    options,
    selectedValues,
    onChange,
    helperText,
    disabled = false
}) => {
    const handleToggle = (value: string) => {
        if (disabled) return;
        
        if (selectedValues.includes(value)) {
            onChange(selectedValues.filter(v => v !== value));
        } else {
            onChange([...selectedValues, value]);
        }
    };

    return (
        <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                {label}
            </label>
            {helperText && (
                <div style={{
                    fontSize: '12px',
                    color: 'var(--vscode-descriptionForeground)',
                    fontStyle: 'italic',
                    marginBottom: '8px'
                }}>
                    {helperText}
                </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {options.map(option => (
                    <div key={option.value} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                        <input
                            type="checkbox"
                            id={`checkbox_${option.value}`}
                            checked={selectedValues.includes(option.value)}
                            onChange={() => handleToggle(option.value)}
                            disabled={disabled}
                            style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
                        />
                        <label 
                            htmlFor={`checkbox_${option.value}`} 
                            style={{ 
                                cursor: disabled ? 'not-allowed' : 'pointer', 
                                margin: 0,
                                opacity: disabled ? 0.5 : 1
                            }}
                        >
                            {option.label}
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
};


