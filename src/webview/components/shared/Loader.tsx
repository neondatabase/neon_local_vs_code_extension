import React from 'react';
import { spacing } from '../../design-system';

interface LoaderProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export const Loader: React.FC<LoaderProps> = ({ size = 'md', text }) => {
  const sizes = {
    sm: '16px',
    md: '24px',
    lg: '32px',
  };

  return (
    <div style={{ textAlign: 'center', padding: spacing.xl }}>
      <div
        style={{
          display: 'inline-block',
          width: sizes[size],
          height: sizes[size],
          border: '3px solid var(--vscode-progressBar-background)',
          borderTopColor: 'var(--vscode-button-background)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      {text && <div style={{ marginTop: spacing.md, color: 'var(--vscode-descriptionForeground)' }}>{text}</div>}
      <style>
        {`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};


