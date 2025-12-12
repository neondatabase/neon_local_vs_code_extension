import React from 'react';
import { colors, spacing, componentStyles, mergeStyles } from '../../design-system';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  loading?: boolean;
  loadingText?: string;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  loadingText = 'Loading...',
  icon,
  children,
  disabled,
  style,
  ...props
}) => {
  const sizes = {
    sm: { padding: `${spacing.xs} ${spacing.sm}`, fontSize: '12px' },
    md: { padding: `${spacing.sm} ${spacing.md}`, fontSize: '13px' },
    lg: { padding: `${spacing.md} ${spacing.lg}`, fontSize: '14px' },
  };

  const variants = {
    primary: componentStyles.button.primary,
    secondary: componentStyles.button.secondary,
    danger: { backgroundColor: colors.error, color: colors.primaryForeground },
  };

  const buttonStyle = mergeStyles(
    componentStyles.button.base,
    variants[variant],
    sizes[size],
    fullWidth ? { width: '100%' } : undefined,
    (disabled || loading) ? componentStyles.button.disabled : undefined,
    style
  );

  return (
    <button
      style={buttonStyle}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span>{loadingText}</span>
      ) : (
        <>
          {icon && <span style={{ marginRight: spacing.xs }}>{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
};

