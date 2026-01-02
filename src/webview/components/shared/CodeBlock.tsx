import React, { useState } from 'react';
import { colors, spacing, borderRadius, fontSize } from '../../design-system';

interface CodeBlockProps {
  code: string;
  language?: 'sql' | 'javascript' | 'typescript' | 'python' | 'json';
  readonly?: boolean;
  maxHeight?: string;
  showCopy?: boolean;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = 'sql',
  readonly = true,
  maxHeight = '400px',
  showCopy = true,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ position: 'relative' }}>
      {showCopy && (
        <button
          onClick={handleCopy}
          style={{
            position: 'absolute',
            top: spacing.sm,
            right: spacing.sm,
            padding: `${spacing.xs} ${spacing.sm}`,
            background: colors.backgroundLight,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.sm,
            cursor: 'pointer',
            fontSize: fontSize.xs,
            color: colors.textPrimary,
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      )}
      <pre
        style={{
          backgroundColor: colors.backgroundDark,
          color: colors.foreground,
          padding: spacing.md,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          overflow: 'auto',
          maxHeight,
          fontSize: fontSize.sm,
          fontFamily: 'var(--vscode-editor-font-family)',
          margin: 0,
        }}
      >
        <code style={{ backgroundColor: 'transparent' }}>{code}</code>
      </pre>
    </div>
  );
};

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  placeholder?: string;
  minHeight?: string;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language = 'sql',
  placeholder = 'Enter code here...',
  minHeight = '150px',
}) => {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%',
        minHeight,
        padding: spacing.md,
        backgroundColor: colors.backgroundDark,
        color: colors.foreground,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        fontSize: fontSize.sm,
        fontFamily: 'var(--vscode-editor-font-family)',
        resize: 'vertical',
        outline: 'none',
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = colors.focusBorder;
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = colors.border;
      }}
    />
  );
};

