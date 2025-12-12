import React from 'react';
import { colors, spacing } from '../../design-system';

interface StatusIndicatorProps {
  status: 'connected' | 'disconnected' | 'loading' | 'error';
  label?: string;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, label }) => {
  const statusConfig = {
    connected: {
      color: colors.success,
      label: label || 'Connected',
    },
    disconnected: {
      color: colors.textSecondary,
      label: label || 'Disconnected',
    },
    loading: {
      color: colors.info,
      label: label || 'Connecting...',
    },
    error: {
      color: colors.error,
      label: label || 'Error',
    },
  };

  const config = statusConfig[status];

  return (
    <div style={{ display: 'flex', alignItems: 'center', fontSize: '13px', fontWeight: 500 }}>
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: config.color,
          marginRight: spacing.sm,
          boxShadow: status === 'connected' ? `0 0 4px ${config.color}` : 'none',
        }}
      />
      <span style={{ color: config.color }}>{config.label}</span>
    </div>
  );
};

interface DividerProps {
  spacing?: 'sm' | 'md' | 'lg';
  variant?: 'solid' | 'dashed';
}

export const Divider: React.FC<DividerProps> = ({ spacing: spacingSize = 'md', variant = 'solid' }) => {
  const spacingMap = {
    sm: '8px',
    md: '16px',
    lg: '24px',
  };

  return (
    <hr
      style={{
        border: 'none',
        borderTop: `1px ${variant} ${colors.border}`,
        margin: `${spacingMap[spacingSize]} 0`,
      }}
    />
  );
};

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: `${spacing.xxl} ${spacing.lg}`,
        color: colors.textSecondary,
      }}
    >
      {icon && <div style={{ fontSize: '48px', marginBottom: spacing.md, opacity: 0.5 }}>{icon}</div>}
      <h3 style={{ margin: 0, marginBottom: spacing.sm, fontSize: '16px', color: colors.textPrimary }}>
        {title}
      </h3>
      {description && (
        <p style={{ margin: 0, marginBottom: spacing.lg, fontSize: '13px' }}>{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
};


