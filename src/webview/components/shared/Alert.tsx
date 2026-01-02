import React from 'react';
import { colors, spacing, borderRadius } from '../../design-system';

interface AlertProps {
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ type, title, children, onClose }, ref) => {
  const typeStyles = {
    success: { backgroundColor: 'rgba(0, 255, 0, 0.1)', borderColor: colors.success },
    error: { backgroundColor: 'rgba(255, 0, 0, 0.1)', borderColor: colors.error },
    warning: { backgroundColor: 'rgba(255, 165, 0, 0.1)', borderColor: colors.warning },
    info: { backgroundColor: 'rgba(0, 123, 255, 0.1)', borderColor: colors.info },
  };

  return (
    <div 
      ref={ref}
      style={{
      ...typeStyles[type],
      border: `1px solid ${typeStyles[type].borderColor}`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
      position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div style={{ flex: 1 }}>
          {title && <div style={{ fontWeight: 600, marginBottom: spacing.xs }}>{title}</div>}
          <div>{children}</div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: spacing.xs,
              marginLeft: spacing.sm,
              color: colors.textSecondary,
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
});

Alert.displayName = 'Alert';
