import React, { useState } from 'react';
import { colors, spacing, fontSize, borderRadius } from '../../design-system';

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  copyable?: boolean;
}

export const InfoRow: React.FC<InfoRowProps> = ({ label, value, copyable = false }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof value === 'string') {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: `${spacing.sm} 0`,
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      <div>
        <div
          style={{
            fontSize: fontSize.xs,
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: spacing.xs,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: fontSize.md, color: colors.textPrimary }}>{value}</div>
      </div>
      {copyable && (
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: spacing.xs,
            fontSize: fontSize.sm,
            color: colors.link,
          }}
        >
          {copied ? '✓' : '📋'}
        </button>
      )}
    </div>
  );
};

interface InfoGridProps {
  items: Array<{ label: string; value: React.ReactNode }>;
  columns?: 1 | 2 | 3;
}

export const InfoGrid: React.FC<InfoGridProps> = ({ items, columns = 2 }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: spacing.md,
      }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          style={{
            padding: spacing.md,
            backgroundColor: colors.backgroundLight,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
          }}
        >
          <div
            style={{
              fontSize: fontSize.xs,
              color: colors.textSecondary,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: spacing.xs,
            }}
          >
            {item.label}
          </div>
          <div style={{ fontSize: fontSize.lg, color: colors.textPrimary, fontWeight: 600 }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
};

interface StatsCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export const StatsCard: React.FC<StatsCardProps> = ({ label, value, icon, variant = 'default' }) => {
  const variantColors = {
    default: colors.textPrimary,
    success: colors.success,
    warning: colors.warning,
    error: colors.error,
  };

  return (
    <div
      style={{
        padding: spacing.lg,
        backgroundColor: colors.backgroundLight,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        textAlign: 'center',
      }}
    >
      {icon && <div style={{ fontSize: '24px', marginBottom: spacing.sm }}>{icon}</div>}
      <div
        style={{
          fontSize: '28px',
          fontWeight: 700,
          color: variantColors[variant],
          marginBottom: spacing.xs,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>{label}</div>
    </div>
  );
};

