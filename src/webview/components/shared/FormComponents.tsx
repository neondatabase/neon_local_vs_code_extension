import React from 'react';
import { spacing } from '../../design-system';

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({ label, style, ...props }) => {
  return (
    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', ...style }}>
      <input
        type="checkbox"
        style={{ marginRight: spacing.sm, cursor: 'pointer' }}
        {...props}
      />
      {label && <span>{label}</span>}
    </label>
  );
};

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  fullWidth?: boolean;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  fullWidth = true,
  style,
  ...props
}) => {
  return (
    <div style={{ marginBottom: spacing.md }}>
      {label && <label style={{ display: 'block', marginBottom: spacing.sm, fontWeight: 600 }}>{label}</label>}
      <textarea
        style={{
          width: fullWidth ? '100%' : 'auto',
          padding: spacing.sm,
          fontSize: '13px',
          backgroundColor: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: `1px solid ${error ? 'var(--vscode-inputValidation-errorBorder)' : 'var(--vscode-input-border)'}`,
          borderRadius: '4px',
          outline: 'none',
          fontFamily: 'inherit',
          resize: 'vertical',
          minHeight: '80px',
          ...style,
        }}
        {...props}
      />
      {error && (
        <div style={{ color: 'var(--vscode-inputValidation-errorForeground)', fontSize: '12px', marginTop: '4px' }}>
          {error}
        </div>
      )}
    </div>
  );
};

interface FormRowProps {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}

export const FormRow: React.FC<FormRowProps> = ({ label, children, required }) => {
  return (
    <div style={{ marginBottom: spacing.md }}>
      <label style={{ display: 'block', marginBottom: spacing.sm, fontWeight: 600 }}>
        {label}
        {required && <span style={{ color: 'var(--vscode-errorForeground)' }}> *</span>}
      </label>
      {children}
    </div>
  );
};


