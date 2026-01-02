/**
 * Design System - Centralized Styling Tokens
 * 
 * This file contains all design tokens (colors, spacing, typography, etc.)
 * that should be used consistently across all panels and components.
 */

export const colors = {
  // VSCode theme colors (uses CSS variables that adapt to theme)
  background: 'var(--vscode-editor-background)',
  foreground: 'var(--vscode-editor-foreground)',
  
  // Primary colors
  primary: 'var(--vscode-button-background)',
  primaryHover: 'var(--vscode-button-hoverBackground)',
  primaryForeground: 'var(--vscode-button-foreground)',
  
  // Secondary colors
  secondary: 'var(--vscode-button-secondaryBackground)',
  secondaryHover: 'var(--vscode-button-secondaryHoverBackground)',
  secondaryForeground: 'var(--vscode-button-secondaryForeground)',
  
  // Input colors
  inputBackground: 'var(--vscode-input-background)',
  inputForeground: 'var(--vscode-input-foreground)',
  inputBorder: 'var(--vscode-input-border)',
  inputPlaceholder: 'var(--vscode-input-placeholderForeground)',
  
  // Dropdown colors
  dropdownBackground: 'var(--vscode-dropdown-background)',
  dropdownForeground: 'var(--vscode-dropdown-foreground)',
  dropdownBorder: 'var(--vscode-dropdown-border)',
  
  // Status colors
  success: 'var(--vscode-testing-iconPassed)',
  error: 'var(--vscode-errorForeground)',
  warning: 'var(--vscode-editorWarning-foreground)',
  info: 'var(--vscode-editorInfo-foreground)',
  
  // Border colors
  border: 'var(--vscode-panel-border)',
  focusBorder: 'var(--vscode-focusBorder)',
  
  // Background variants
  backgroundLight: 'var(--vscode-sideBar-background)',
  backgroundDark: 'var(--vscode-activityBar-background)',
  
  // Text colors
  textPrimary: 'var(--vscode-foreground)',
  textSecondary: 'var(--vscode-descriptionForeground)',
  textMuted: 'var(--vscode-disabledForeground)',
  
  // List colors
  listHover: 'var(--vscode-list-hoverBackground)',
  listActive: 'var(--vscode-list-activeSelectionBackground)',
  listActiveForeground: 'var(--vscode-list-activeSelectionForeground)',
  
  // Badge colors
  badgeBackground: 'var(--vscode-badge-background)',
  badgeForeground: 'var(--vscode-badge-foreground)',
  
  // Links
  link: 'var(--vscode-textLink-foreground)',
  linkHover: 'var(--vscode-textLink-activeForeground)',
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
} as const;

export const borderRadius = {
  sm: '2px',
  md: '4px',
  lg: '6px',
  full: '9999px',
} as const;

export const fontSize = {
  xs: '11px',
  sm: '12px',
  md: '13px',
  lg: '14px',
  xl: '16px',
  xxl: '18px',
} as const;

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const lineHeight = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75,
} as const;

export const shadows = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
} as const;

export const transitions = {
  fast: '150ms ease-in-out',
  normal: '250ms ease-in-out',
  slow: '350ms ease-in-out',
} as const;

export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  modal: 1200,
  popover: 1300,
  tooltip: 1400,
} as const;

/**
 * Common component styles
 */
export const componentStyles = {
  panelTitle: {
    fontSize: '20px',
    fontWeight: fontWeight.normal,
    marginBottom: spacing.lg,
  },
  button: {
    base: {
      padding: `${spacing.sm} ${spacing.lg}`,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
      borderRadius: borderRadius.md,
      border: 'none',
      cursor: 'pointer',
      transition: transitions.fast,
      outline: 'none',
    },
    primary: {
      backgroundColor: colors.primary,
      color: colors.primaryForeground,
    },
    secondary: {
      backgroundColor: colors.secondary,
      color: colors.secondaryForeground,
    },
    disabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  input: {
    base: {
      width: '100%',
      padding: `${spacing.sm} ${spacing.md}`,
      fontSize: fontSize.md,
      backgroundColor: colors.inputBackground,
      color: colors.inputForeground,
      border: `1px solid ${colors.inputBorder}`,
      borderRadius: borderRadius.md,
      outline: 'none',
      transition: transitions.fast,
      boxSizing: 'border-box' as const,
    },
  },
  select: {
    base: {
      width: '100%',
      padding: `${spacing.sm} ${spacing.md}`,
      paddingRight: '32px',
      fontSize: fontSize.md,
      backgroundColor: colors.dropdownBackground,
      color: colors.dropdownForeground,
      border: `1px solid ${colors.dropdownBorder}`,
      borderRadius: borderRadius.md,
      outline: 'none',
      cursor: 'pointer',
      boxSizing: 'border-box' as const,
      appearance: 'none' as const,
      backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z' fill='%23C5C5C5'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat' as const,
      backgroundPosition: 'right 8px center',
    },
  },
  card: {
    base: {
      backgroundColor: colors.backgroundLight,
      border: `1px solid ${colors.border}`,
      borderRadius: borderRadius.lg,
      padding: spacing.lg,
    },
  },
  formGroup: {
    base: {
      marginBottom: spacing.lg,
    },
  },
  label: {
    base: {
      display: 'block',
      marginBottom: spacing.sm,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
      color: colors.textPrimary,
    },
  },
} as const;

/**
 * Utility function to merge styles
 */
export function mergeStyles(...styles: Array<React.CSSProperties | undefined>): React.CSSProperties {
  return Object.assign({}, ...styles.filter(Boolean));
}

/**
 * Common layout styles
 */
export const layouts = {
  container: {
    padding: spacing.lg,
    maxWidth: '100%',
    overflow: 'auto',
  },
  flexRow: {
    display: 'flex',
    flexDirection: 'row' as const,
    gap: spacing.md,
  },
  flexColumn: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: spacing.md,
  },
  grid: {
    display: 'grid',
    gap: spacing.md,
  },
  spaceBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
} as const;

