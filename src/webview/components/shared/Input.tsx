import React from 'react';
import { componentStyles, mergeStyles } from '../../design-system';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  noWrapper?: boolean; // Skip the formGroup wrapper (useful for table cells)
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  fullWidth = true,
  noWrapper = false,
  style,
  disabled,
  ...props
}) => {
  const inputElement = (
    <input
      style={mergeStyles(
        componentStyles.input.base,
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
    />
  );

  if (noWrapper) {
    return inputElement;
  }

  return (
    <div style={componentStyles.formGroup.base}>
      {label && <label style={componentStyles.label.base}>{label}</label>}
      {inputElement}
      {error && (
        <div style={{ color: 'var(--vscode-inputValidation-errorForeground)', fontSize: '12px', marginTop: '4px' }}>
          {error}
        </div>
      )}
      {helperText && !error && (
        <div style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px', marginTop: '4px' }}>
          {helperText}
        </div>
      )}
    </div>
  );
};

