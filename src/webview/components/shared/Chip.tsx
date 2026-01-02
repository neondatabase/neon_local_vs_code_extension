import React, { useState } from 'react';
import { colors, spacing, borderRadius, fontSize } from '../../design-system';
import { Button } from './Button';

interface ChipProps {
  label: string;
  onRemove?: () => void;
  variant?: 'default' | 'primary' | 'success';
}

export const Chip: React.FC<ChipProps> = ({ label, onRemove, variant = 'default' }) => {
  const variantStyles = {
    default: {
      backgroundColor: colors.backgroundLight,
      color: colors.textPrimary,
      border: `1px solid ${colors.border}`,
    },
    primary: {
      backgroundColor: 'rgba(0, 120, 212, 0.2)',
      color: colors.primary,
      border: `1px solid ${colors.primary}`,
    },
    success: {
      backgroundColor: 'rgba(115, 201, 145, 0.2)',
      color: colors.success,
      border: `1px solid ${colors.success}`,
    },
  };

  return (
    <span
      style={{
        ...variantStyles[variant],
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing.xs,
        padding: `${spacing.xs} ${spacing.sm}`,
        borderRadius: borderRadius.full,
        fontSize: fontSize.sm,
      }}
    >
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            color: 'inherit',
            fontSize: '12px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
};

interface ChipListProps {
  items: string[];
  onRemove?: (index: number) => void;
  variant?: 'default' | 'primary' | 'success';
  emptyMessage?: string;
}

export const ChipList: React.FC<ChipListProps> = ({
  items,
  onRemove,
  variant = 'default',
  emptyMessage = 'No items',
}) => {
  if (items.length === 0) {
    return (
      <div style={{ color: colors.textSecondary, fontSize: fontSize.sm, fontStyle: 'italic' }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
      {items.map((item, index) => (
        <Chip
          key={index}
          label={item}
          variant={variant}
          onRemove={onRemove ? () => onRemove(index) : undefined}
        />
      ))}
    </div>
  );
};



