import React from 'react';
import { spacing } from '../../design-system';

interface ColumnSelectorProps {
    label: string;
    columns: string[];
    selectedColumns: string[];
    onToggle: (columnName: string) => void;
    helperText?: string;
}

export const ColumnSelector: React.FC<ColumnSelectorProps> = ({
    label,
    columns,
    selectedColumns,
    onToggle,
    helperText
}) => {
    return (
        <div>
            {label && (
                <label style={{ display: 'block', marginBottom: spacing.sm, fontSize: '13px', fontWeight: '500' }}>
                    {label}
                </label>
            )}
            {helperText && (
                <div style={{
                    fontSize: '12px',
                    color: 'var(--vscode-descriptionForeground)',
                    fontStyle: 'italic',
                    marginBottom: spacing.sm
                }}>
                    {helperText}
                </div>
            )}
            <div style={{
                border: '1px solid var(--vscode-input-border)',
                borderRadius: '3px',
                padding: spacing.sm,
                maxHeight: '150px',
                overflowY: 'auto',
                backgroundColor: 'var(--vscode-input-background)'
            }}>
                {columns.length === 0 ? (
                    <div style={{
                        padding: spacing.sm,
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic',
                        fontSize: '12px'
                    }}>
                        No columns available
                    </div>
                ) : (
                    columns.map(col => (
                        <div
                            key={col}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: spacing.sm,
                                padding: '4px',
                                cursor: 'pointer',
                                borderRadius: '3px'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                            onClick={() => onToggle(col)}
                        >
                            <input
                                type="checkbox"
                                checked={selectedColumns.includes(col)}
                                onChange={() => onToggle(col)}
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => e.stopPropagation()}
                            />
                            <label style={{ cursor: 'pointer', margin: 0 }}>{col}</label>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
