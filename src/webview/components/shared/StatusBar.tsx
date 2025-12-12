import React from 'react';
import { colors, spacing, borderRadius, fontSize } from '../../design-system';

interface StatusBarProps {
  children: React.ReactNode;
  leftSection?: React.ReactNode;
  centerSection?: React.ReactNode;
  rightSection?: React.ReactNode;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  children,
  leftSection,
  centerSection,
  rightSection,
}) => {
  // If no sections provided, render children directly
  if (!leftSection && !centerSection && !rightSection) {
    return (
      <div
        style={{
          padding: `${spacing.xs} ${spacing.lg}`,
          backgroundColor: 'var(--vscode-statusBar-background)',
          color: 'var(--vscode-statusBar-foreground)',
          fontSize: fontSize.sm,
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.md,
          flexShrink: 0,
        }}
      >
        {children}
      </div>
    );
  }

  // Three-section layout
  return (
    <div
      style={{
        padding: `${spacing.xs} ${spacing.lg}`,
        backgroundColor: 'var(--vscode-statusBar-background)',
        color: 'var(--vscode-statusBar-foreground)',
        fontSize: fontSize.sm,
        borderTop: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, flex: 1 }}>
        {leftSection}
      </div>
      {centerSection && (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>{centerSection}</div>
      )}
      {rightSection && (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, flex: 1, justifyContent: 'flex-end' }}>
          {rightSection}
        </div>
      )}
    </div>
  );
};

interface StatusBarItemProps {
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  variant?: 'default' | 'warning' | 'error';
}

export const StatusBarItem: React.FC<StatusBarItemProps> = ({ icon, label, onClick, variant = 'default' }) => {
  const variantColors = {
    default: 'var(--vscode-statusBar-foreground)',
    warning: 'var(--vscode-editorWarning-foreground)',
    error: 'var(--vscode-errorForeground)',
  };

  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    color: variantColors[variant],
    cursor: onClick ? 'pointer' : 'default',
    padding: onClick ? `${spacing.xs} ${spacing.sm}` : 0,
    borderRadius: borderRadius.sm,
  };

  const content = (
    <>
      {icon}
      <span>{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        style={{
          ...style,
          background: 'none',
          border: 'none',
          fontSize: fontSize.sm,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {content}
      </button>
    );
  }

  return <div style={style}>{content}</div>;
};


