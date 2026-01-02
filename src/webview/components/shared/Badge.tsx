import React from 'react';
import { colors, spacing, borderRadius, fontSize } from '../../design-system';

interface BadgeProps {
  variant: 'primary' | 'success' | 'warning' | 'error' | 'info' | 'superuser' | 'user' | 'role';
  children: React.ReactNode;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ variant, children, size = 'md' }) => {
  const variantStyles = {
    primary: {
      backgroundColor: colors.primary,
      color: colors.primaryForeground,
    },
    success: {
      backgroundColor: 'rgba(115, 201, 145, 0.2)',
      color: colors.success,
      border: `1px solid ${colors.success}`,
    },
    warning: {
      backgroundColor: 'rgba(255, 165, 0, 0.2)',
      color: colors.warning,
      border: `1px solid ${colors.warning}`,
    },
    error: {
      backgroundColor: 'rgba(255, 0, 0, 0.2)',
      color: colors.error,
      border: `1px solid ${colors.error}`,
    },
    info: {
      backgroundColor: 'rgba(0, 123, 255, 0.2)',
      color: colors.info,
      border: `1px solid ${colors.info}`,
    },
    superuser: {
      backgroundColor: 'rgba(255, 100, 100, 0.2)',
      color: '#ff6464',
      border: '1px solid #ff6464',
    },
    user: {
      backgroundColor: 'rgba(100, 200, 255, 0.2)',
      color: '#64c8ff',
      border: '1px solid #64c8ff',
    },
    role: {
      backgroundColor: 'rgba(200, 200, 200, 0.2)',
      color: colors.textSecondary,
      border: `1px solid ${colors.textSecondary}`,
    },
  };

  const sizeStyles = {
    sm: {
      padding: `${spacing.xs} ${spacing.sm}`,
      fontSize: fontSize.xs,
    },
    md: {
      padding: `${spacing.xs} ${spacing.md}`,
      fontSize: fontSize.sm,
    },
  };

  return (
    <span
      style={{
        ...variantStyles[variant],
        ...sizeStyles[size],
        borderRadius: borderRadius.full,
        display: 'inline-flex',
        alignItems: 'center',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
};

interface StatusBadgeProps {
  status: 'new' | 'modified' | 'deleted' | 'active' | 'inactive';
  children?: React.ReactNode;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, children }) => {
  const statusConfig = {
    new: { variant: 'success' as const, label: 'NEW' },
    modified: { variant: 'warning' as const, label: 'MODIFIED' },
    deleted: { variant: 'error' as const, label: 'DELETED' },
    active: { variant: 'success' as const, label: 'ACTIVE' },
    inactive: { variant: 'info' as const, label: 'INACTIVE' },
  };

  const config = statusConfig[status];
  
  return (
    <Badge variant={config.variant} size="sm">
      {children || config.label}
    </Badge>
  );
};



