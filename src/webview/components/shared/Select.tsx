import React from 'react';
import { componentStyles, mergeStyles } from '../../design-system';
import { Tooltip } from './Tooltip';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  labelTooltip?: string;
  error?: string;
  helperText?: string;
  options: Array<{ value: string; label: string }>;
  fullWidth?: boolean;
  noWrapper?: boolean; // Skip the formGroup wrapper (useful for table cells)
}

export const Select: React.FC<SelectProps> = ({
  label,
  labelTooltip,
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
        } : undefined,
        style,
        // Ensure chevron icon is always present
        {
          backgroundImage: componentStyles.select.base.backgroundImage,
          backgroundRepeat: componentStyles.select.base.backgroundRepeat,
          backgroundPosition: componentStyles.select.base.backgroundPosition,
        }
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
      {label && (
        <label style={{ ...componentStyles.label.base, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>
            {label}
            {props.required && <span style={{ color: 'var(--vscode-errorForeground)', marginLeft: '2px' }}>*</span>}
          </span>
          {labelTooltip && <Tooltip text={labelTooltip} />}
        </label>
      )}
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

