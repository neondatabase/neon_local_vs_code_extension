import React from 'react';
import { colors, spacing, borderRadius } from '../../design-system';
import { Button } from './Button';

interface ToolbarProps {
  title?: string;
  leftActions?: React.ReactNode;
  rightActions?: React.ReactNode;
  children?: React.ReactNode;
}

export const Toolbar: React.FC<ToolbarProps> = ({ title, leftActions, rightActions, children }) => {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: spacing.md,
        backgroundColor: colors.backgroundLight,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        marginBottom: spacing.md,
        gap: spacing.md,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, flex: 1 }}>
        {title && <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{title}</h3>}
        {leftActions}
      </div>
      {children}
      {rightActions && <div style={{ display: 'flex', gap: spacing.sm }}>{rightActions}</div>}
    </div>
  );
};

interface ButtonGroupProps {
  children: React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ children, align = 'left' }) => {
  const alignments = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: spacing.sm,
        justifyContent: alignments[align],
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  );
};

interface ActionButtonsProps {
  onSave?: () => void;
  onCancel?: () => void;
  onDelete?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  deleteLabel?: string;
  saveDisabled?: boolean;
  deleteDisabled?: boolean;
  loading?: boolean;
  loadingText?: string;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onSave,
  onCancel,
  onDelete,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  deleteLabel = 'Delete',
  saveDisabled = false,
  deleteDisabled = false,
  loading = false,
  loadingText,
}) => {
  return (
    <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'space-between', marginTop: spacing.lg }}>
      <div>
        {onDelete && (
          <Button variant="danger" onClick={onDelete} disabled={deleteDisabled || loading}>
            {deleteLabel}
          </Button>
        )}
      </div>
      <div style={{ display: 'flex', gap: spacing.sm }}>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
        )}
        {onSave && (
          <Button variant="primary" onClick={onSave} disabled={saveDisabled} loading={loading} loadingText={loadingText}>
            {saveLabel}
          </Button>
        )}
      </div>
    </div>
  );
};

