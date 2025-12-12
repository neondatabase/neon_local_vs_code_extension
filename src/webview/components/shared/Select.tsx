import React from 'react';
import { componentStyles, mergeStyles } from '../../design-system';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: Array<{ value: string; label: string }>;
  fullWidth?: boolean;
  noWrapper?: boolean; // Skip the formGroup wrapper (useful for table cells)
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  helperText,
  options,
  fullWidth = true,
  noWrapper = false,
  style,
  disabled,
  ...props
}) => {
  const selectElement = (
    <select
      style={mergeStyles(
        componentStyles.select.base,
        !fullWidth ? { width: 'auto' } : undefined,
        error ? { borderColor: 'var(--vscode-inputValidation-errorBorder)' } : undefined,
        disabled ? { 
          opacity: 0.5,
          cursor: 'not-allowed',
          backgroundColor: 'var(--vscode-input-background)',
        } : undefined,
        style
      )}
      disabled={disabled}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  if (noWrapper) {
    return selectElement;
  }

  return (
    <div style={componentStyles.formGroup.base}>
      {label && <label style={componentStyles.label.base}>{label}</label>}
      {selectElement}
      {error && (
        <div style={{ color: 'var(--vscode-inputValidation-errorForeground)', fontSize: '12px', marginTop: '4px' }}>
          {error}
        </div>
      )}
      {!error && helperText && (
        <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '4px' }}>
          {helperText}
        </div>
      )}
    </div>
  );
};

