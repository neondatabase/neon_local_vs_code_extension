import React from 'react';
import { spacing } from '../../design-system';

interface Permission {
    type: string;
    object: string;
    privileges: string[];
    onRevoke?: () => void;
}

interface PermissionsTableProps {
    permissions: Permission[];
    onRevoke?: (permission: Permission) => void;
    emptyMessage?: string;
}

export const PermissionsTable: React.FC<PermissionsTableProps> = ({
    permissions,
    onRevoke,
    emptyMessage = 'No permissions granted yet'
}) => {
    if (permissions.length === 0) {
        return (
            <div style={{
                padding: spacing.lg,
                textAlign: 'center',
                color: 'var(--vscode-descriptionForeground)',
                fontStyle: 'italic'
            }}>
                {emptyMessage}
            </div>
        );
    }

    return (
        <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table style={{
                width: '100%',
                borderCollapse: 'collapse'
            }}>
                <thead>
                    <tr>
                        <th style={{
                            padding: '8px 12px',
                            textAlign: 'left',
                            borderBottom: '1px solid var(--vscode-widget-border)',
                            fontWeight: '600',
                            backgroundColor: 'var(--vscode-editor-background)',
                            color: 'var(--vscode-foreground)',
                            whiteSpace: 'nowrap'
                        }}>
                            Type
                        </th>
                        <th style={{
                            padding: '8px 12px',
                            textAlign: 'left',
                            borderBottom: '1px solid var(--vscode-widget-border)',
                            fontWeight: '600',
                            backgroundColor: 'var(--vscode-editor-background)',
                            color: 'var(--vscode-foreground)',
                            whiteSpace: 'nowrap'
                        }}>
                            Object
                        </th>
                        <th style={{
                            padding: '8px 12px',
                            textAlign: 'left',
                            borderBottom: '1px solid var(--vscode-widget-border)',
                            fontWeight: '600',
                            backgroundColor: 'var(--vscode-editor-background)',
                            color: 'var(--vscode-foreground)',
                            whiteSpace: 'nowrap'
                        }}>
                            Privileges
                        </th>
                        {onRevoke && (
                            <th style={{
                                padding: '8px 12px',
                                textAlign: 'left',
                                borderBottom: '1px solid var(--vscode-widget-border)',
                                fontWeight: '600',
                                backgroundColor: 'var(--vscode-editor-background)',
                                color: 'var(--vscode-foreground)',
                                whiteSpace: 'nowrap',
                                width: '100px'
                            }}>
                                Actions
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {permissions.map((perm, index) => (
                        <tr 
                            key={index}
                            style={{
                                transition: 'background-color 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <td style={{
                                padding: '8px 12px',
                                borderBottom: '1px solid var(--vscode-widget-border)',
                                whiteSpace: 'nowrap'
                            }}>
                                {perm.type}
                            </td>
                            <td style={{
                                padding: '8px 12px',
                                borderBottom: '1px solid var(--vscode-widget-border)',
                                whiteSpace: 'nowrap'
                            }}>
                                {perm.object}
                            </td>
                            <td style={{
                                padding: '8px 12px',
                                borderBottom: '1px solid var(--vscode-widget-border)',
                                whiteSpace: 'nowrap'
                            }}>
                                {perm.privileges.filter(p => p).join(', ')}
                            </td>
                            {onRevoke && (
                                <td style={{
                                    padding: '8px 12px',
                                    borderBottom: '1px solid var(--vscode-widget-border)',
                                    whiteSpace: 'nowrap'
                                }}>
                                    <button
                                        onClick={() => onRevoke(perm)}
                                        style={{
                                            padding: '4px 12px',
                                            fontSize: '12px',
                                            backgroundColor: 'var(--vscode-errorForeground)',
                                            color: 'var(--vscode-button-foreground)',
                                            border: 'none',
                                            borderRadius: '3px',
                                            cursor: 'pointer'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                                        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                    >
                                        Revoke
                                    </button>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};


