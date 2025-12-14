import React, { useState, useEffect } from 'react';
import {
    Input,
    Select,
    Section,
    ActionButtons,
    SqlPreview,
    useScrollToError,
    Tooltip
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

interface PolicyRole {
    rolname: string;
}

interface PolicyColumn {
    column_name: string;
    data_type: string;
}

interface CreatePolicyProps {
    schema: string;
    tableName: string;
    roles: PolicyRole[];
    columns: PolicyColumn[];
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const POLICY_TYPES = [
    { value: 'PERMISSIVE', label: 'PERMISSIVE (Allow matching rows)' },
    { value: 'RESTRICTIVE', label: 'RESTRICTIVE (Deny non-matching rows)' }
];

const COMMANDS = [
    { value: 'ALL', label: 'ALL - All operations' },
    { value: 'SELECT', label: 'SELECT - Read access' },
    { value: 'INSERT', label: 'INSERT - Create access' },
    { value: 'UPDATE', label: 'UPDATE - Modify access' },
    { value: 'DELETE', label: 'DELETE - Remove access' }
];

interface EditPolicyProps {
    schema: string;
    tableName: string;
    policyName: string;
    policyInfo: {
        policy_name: string;
        is_permissive: boolean;
        command: string;
        roles: string[] | null;
        using_expression: string | null;
        with_check_expression: string | null;
    };
    roles: PolicyRole[];
    columns: PolicyColumn[];
}

export const CreatePolicyComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as CreatePolicyProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const availableRoles = initialData.roles || [];
    const availableColumns = initialData.columns || [];
    
    const [policyName, setPolicyName] = useState('');
    const [policyType, setPolicyType] = useState('PERMISSIVE');
    const [command, setCommand] = useState('ALL');
    const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
    const [usingExpression, setUsingExpression] = useState('');
    const [withCheckExpression, setWithCheckExpression] = useState('');

    const [error, setError] = useState('');
    const [validationError, setValidationError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    const validatePolicyName = (name: string): string => {
        if (!name.trim()) {
            return 'Policy name is required';
        }
        
        // Check for valid PostgreSQL identifier
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            return 'Policy name must start with a letter or underscore and contain only letters, numbers, and underscores';
        }
        
        // Check for reserved prefixes
        if (name.toLowerCase().startsWith('pg_')) {
            return 'Policy name cannot start with "pg_" (reserved prefix)';
        }
        
        return '';
    };

    const handlePolicyNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        setPolicyName(newName);
        setValidationError(validatePolicyName(newName));
    };

    // Determine which expression fields to show based on command
    const shouldShowUsing = () => {
        // USING is used for SELECT, UPDATE, DELETE, and ALL
        return command === 'ALL' || command === 'SELECT' || command === 'UPDATE' || command === 'DELETE';
    };

    const shouldShowWithCheck = () => {
        // WITH CHECK is used for INSERT, UPDATE, and ALL
        return command === 'ALL' || command === 'INSERT' || command === 'UPDATE';
    };

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    setSqlPreview(message.sql);
                    break;
                case 'error':
                    setError(message.error);
                    setIsSubmitting(false);
                    break;
                case 'loading':
                    setIsSubmitting(message.loading);
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    useEffect(() => {
        if (policyName) {
            const policyDef = {
                name: policyName,
                type: policyType,
                command,
                roles: selectedRoles.length > 0 ? selectedRoles : undefined,
                usingExpression: usingExpression || undefined,
                withCheckExpression: withCheckExpression || undefined
            };
            vscode.postMessage({ command: 'previewSql', policyDef });
        } else {
            setSqlPreview('');
        }
    }, [policyName, policyType, command, selectedRoles, usingExpression, withCheckExpression]);

    const handleRoleToggle = (roleName: string) => {
        setSelectedRoles(prev => 
            prev.includes(roleName) ? prev.filter(r => r !== roleName) : [...prev, roleName]
        );
    };

    const handleSubmit = () => {
        const nameError = validatePolicyName(policyName);
        if (nameError) {
            setError(nameError);
            setValidationError(nameError);
            return;
        }

        setError('');
        setIsSubmitting(true);

        const policyDef = {
            name: policyName,
            type: policyType,
            command,
            roles: selectedRoles.length > 0 ? selectedRoles : undefined,
            usingExpression: usingExpression || undefined,
            withCheckExpression: withCheckExpression || undefined
        };

        vscode.postMessage({ command: 'createPolicy', policyDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create Policy on {schema}.{tableName}
            </h1>

            {error && (
                <div 
                    ref={errorRef}
                    style={{
                        backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
                        border: '1px solid var(--vscode-inputValidation-errorBorder)',
                        color: 'var(--vscode-inputValidation-errorForeground)',
                        padding: spacing.md,
                        borderRadius: '4px',
                        marginBottom: spacing.lg
                    }}
                >
                    {error}
                </div>
            )}

            <Section>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Policy Name"
                        value={policyName}
                        onChange={handlePolicyNameChange}
                        error={validationError}
                        required
                    />

                    <Select
                        label="Policy Type"
                        value={policyType}
                        onChange={(e) => setPolicyType(e.target.value)}
                        options={POLICY_TYPES}
                        required
                    />

                    <Select
                        label="Command"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        options={COMMANDS}
                        required
                        labelTooltip="Which database operations this policy applies to"
                    />

                    <div>
                        <label style={{ display: 'block', marginBottom: spacing.sm, fontSize: '13px', fontWeight: '500' }}>
                            Roles
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginBottom: spacing.sm
                        }}>
                            Select roles this policy applies to (leave empty for all roles)
                        </div>
                        <div style={{
                            border: '1px solid var(--vscode-input-border)',
                            borderRadius: '3px',
                            padding: spacing.sm,
                            maxHeight: '150px',
                            overflowY: 'auto',
                            backgroundColor: 'var(--vscode-input-background)'
                        }}>
                            {availableRoles.map(role => (
                                <div
                                    key={role.rolname}
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
                                    onClick={() => handleRoleToggle(role.rolname)}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedRoles.includes(role.rolname)}
                                        onChange={() => handleRoleToggle(role.rolname)}
                                        style={{ cursor: 'pointer' }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <label style={{ cursor: 'pointer', margin: 0 }}>{role.rolname}</label>
                                </div>
                            ))}
                        </div>
                    </div>

                    {shouldShowUsing() && (
                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                                USING Expression
                                <Tooltip text="Boolean expression to determine which rows are visible/modifiable" />
                            </label>
                            <textarea
                                value={usingExpression}
                                onChange={(e) => setUsingExpression(e.target.value)}
                                placeholder="e.g., user_id = current_user_id()"
                                rows={4}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'var(--vscode-input-background)',
                                    color: 'var(--vscode-input-foreground)',
                                    border: '1px solid var(--vscode-input-border)',
                                    padding: '8px',
                                    borderRadius: '3px',
                                    fontSize: '13px',
                                    fontFamily: 'var(--vscode-font-family)',
                                    resize: 'vertical'
                                }}
                            />
                        </div>
                    )}

                    {shouldShowWithCheck() && (
                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                                WITH CHECK Expression (Optional)
                                <Tooltip text="For INSERT/UPDATE: boolean expression to check new rows (defaults to USING expression)" />
                            </label>
                            <textarea
                                value={withCheckExpression}
                                onChange={(e) => setWithCheckExpression(e.target.value)}
                                placeholder="e.g., status = 'active'"
                                rows={4}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'var(--vscode-input-background)',
                                    color: 'var(--vscode-input-foreground)',
                                    border: '1px solid var(--vscode-input-border)',
                                    padding: '8px',
                                    borderRadius: '3px',
                                    fontSize: '13px',
                                    fontFamily: 'var(--vscode-font-family)',
                                    resize: 'vertical'
                                }}
                            />
                        </div>
                    )}
                </div>
            </Section>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Create Policy"
                loading={isSubmitting}
            />
        </div>
    );
};

export const EditPolicyComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as EditPolicyProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const [oldPolicyName] = useState(initialData.policyName || '');
    const availableRoles = initialData.roles || [];
    const availableColumns = initialData.columns || [];
    const policyInfo = initialData.policyInfo;
    
    // Map PostgreSQL command format to display format
    const mapCommand = (cmd: string): string => {
        switch (cmd) {
            case '*': return 'ALL';
            case 'r': return 'SELECT';
            case 'a': return 'INSERT';
            case 'w': return 'UPDATE';
            case 'd': return 'DELETE';
            default: return 'ALL';
        }
    };

    // Parse PostgreSQL array string format (e.g., "{role1,role2}" or ["role1","role2"])
    const parseRoles = (roles: any): string[] => {
        if (!roles) return [];
        if (Array.isArray(roles)) return roles;
        if (typeof roles === 'string') {
            // Handle PostgreSQL array string notation like "{role1,role2}"
            const trimmed = roles.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                const inner = trimmed.slice(1, -1);
                if (inner === '') return [];
                return inner.split(',').map(r => r.trim());
            }
            return [roles];
        }
        return [roles];
    };

    const [policyName, setPolicyName] = useState(policyInfo?.policy_name || '');
    const [policyType, setPolicyType] = useState(policyInfo?.is_permissive ? 'PERMISSIVE' : 'RESTRICTIVE');
    const [command, setCommand] = useState(mapCommand(policyInfo?.command || '*'));
    const [selectedRoles, setSelectedRoles] = useState<string[]>(parseRoles(policyInfo?.roles));
    const [usingExpression, setUsingExpression] = useState(policyInfo?.using_expression || '');
    const [withCheckExpression, setWithCheckExpression] = useState(policyInfo?.with_check_expression || '');

    // Store original values for change detection
    const originalPolicyName = policyInfo?.policy_name || '';
    const originalPolicyType = policyInfo?.is_permissive ? 'PERMISSIVE' : 'RESTRICTIVE';
    const originalCommand = mapCommand(policyInfo?.command || '*');
    const originalSelectedRoles = parseRoles(policyInfo?.roles);
    const originalUsingExpression = policyInfo?.using_expression || '';
    const originalWithCheckExpression = policyInfo?.with_check_expression || '';

    const [error, setError] = useState('');
    const [validationError, setValidationError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    const validatePolicyName = (name: string): string => {
        if (!name.trim()) {
            return 'Policy name is required';
        }
        
        // Check for valid PostgreSQL identifier
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            return 'Policy name must start with a letter or underscore and contain only letters, numbers, and underscores';
        }
        
        // Check for reserved prefixes
        if (name.toLowerCase().startsWith('pg_')) {
            return 'Policy name cannot start with "pg_" (reserved prefix)';
        }
        
        return '';
    };

    const handlePolicyNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        setPolicyName(newName);
        setValidationError(validatePolicyName(newName));
    };

    // Determine which expression fields to show based on command
    const shouldShowUsing = () => {
        // USING is used for SELECT, UPDATE, DELETE, and ALL
        return command === 'ALL' || command === 'SELECT' || command === 'UPDATE' || command === 'DELETE';
    };

    const shouldShowWithCheck = () => {
        // WITH CHECK is used for INSERT, UPDATE, and ALL
        return command === 'ALL' || command === 'INSERT' || command === 'UPDATE';
    };

    // Helper function to compare arrays
    const arraysEqual = (a: string[], b: string[]): boolean => {
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        return sortedA.every((val, idx) => val === sortedB[idx]);
    };

    // Check if any changes have been made
    const hasChanges = (): boolean => {
        if (policyName !== originalPolicyName) return true;
        if (policyType !== originalPolicyType) return true;
        if (command !== originalCommand) return true;
        if (!arraysEqual(selectedRoles, originalSelectedRoles)) return true;
        if (usingExpression !== originalUsingExpression) return true;
        if (withCheckExpression !== originalWithCheckExpression) return true;
        return false;
    };

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    setSqlPreview(message.sql);
                    break;
                case 'error':
                    setError(message.error);
                    setIsSubmitting(false);
                    break;
                case 'loading':
                    setIsSubmitting(message.loading);
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    useEffect(() => {
        if (!hasChanges()) {
            setSqlPreview('-- No changes will be applied');
            return;
        }

        if (policyName) {
            const policyDef = {
                name: policyName,
                type: policyType,
                command,
                roles: selectedRoles.length > 0 ? selectedRoles : undefined,
                usingExpression: usingExpression || undefined,
                withCheckExpression: withCheckExpression || undefined
            };
            vscode.postMessage({ command: 'previewSql', policyDef });
        } else {
            setSqlPreview('');
        }
    }, [policyName, policyType, command, selectedRoles, usingExpression, withCheckExpression]);

    const handleRoleToggle = (roleName: string) => {
        setSelectedRoles(prev => 
            prev.includes(roleName) ? prev.filter(r => r !== roleName) : [...prev, roleName]
        );
    };

    const handleSubmit = () => {
        const nameError = validatePolicyName(policyName);
        if (nameError) {
            setError(nameError);
            setValidationError(nameError);
            return;
        }

        setError('');
        setIsSubmitting(true);

        const policyDef = {
            name: policyName,
            type: policyType,
            command,
            roles: selectedRoles.length > 0 ? selectedRoles : undefined,
            usingExpression: usingExpression || undefined,
            withCheckExpression: withCheckExpression || undefined
        };

        vscode.postMessage({ command: 'editPolicy', policyDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Edit Policy: {oldPolicyName}
            </h1>

            {error && (
                <div 
                    ref={errorRef}
                    style={{
                        backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
                        border: '1px solid var(--vscode-inputValidation-errorBorder)',
                        color: 'var(--vscode-inputValidation-errorForeground)',
                        padding: spacing.md,
                        borderRadius: '4px',
                        marginBottom: spacing.lg
                    }}
                >
                    {error}
                </div>
            )}

            <Section>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Policy Name"
                        value={policyName}
                        onChange={handlePolicyNameChange}
                        error={validationError}
                        required
                    />

                    <Select
                        label="Policy Type"
                        value={policyType}
                        onChange={(e) => setPolicyType(e.target.value)}
                        options={POLICY_TYPES}
                        required
                    />

                    <Select
                        label="Command"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        options={COMMANDS}
                        required
                        labelTooltip="Which database operations this policy applies to"
                    />

                    <div>
                        <label style={{ display: 'block', marginBottom: spacing.sm, fontSize: '13px', fontWeight: '500' }}>
                            Roles
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginBottom: spacing.sm
                        }}>
                            Select roles this policy applies to (leave empty for all roles)
                        </div>
                        <div style={{
                            border: '1px solid var(--vscode-input-border)',
                            borderRadius: '3px',
                            padding: spacing.sm,
                            maxHeight: '150px',
                            overflowY: 'auto',
                            backgroundColor: 'var(--vscode-input-background)'
                        }}>
                            {availableRoles.map(role => (
                                <div
                                    key={role.rolname}
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
                                    onClick={() => handleRoleToggle(role.rolname)}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedRoles.includes(role.rolname)}
                                        onChange={() => handleRoleToggle(role.rolname)}
                                        style={{ cursor: 'pointer' }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <label style={{ cursor: 'pointer', margin: 0 }}>{role.rolname}</label>
                                </div>
                            ))}
                        </div>
                    </div>

                    {shouldShowUsing() && (
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                                USING Expression
                            </label>
                            <textarea
                                value={usingExpression}
                                onChange={(e) => setUsingExpression(e.target.value)}
                                placeholder="e.g., user_id = current_user_id()"
                                rows={4}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'var(--vscode-input-background)',
                                    color: 'var(--vscode-input-foreground)',
                                    border: '1px solid var(--vscode-input-border)',
                                    padding: '8px',
                                    borderRadius: '3px',
                                    fontSize: '13px',
                                    fontFamily: 'var(--vscode-font-family)',
                                    resize: 'vertical'
                                }}
                            />
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginTop: '4px'
                            }}>
                                Boolean expression to determine which rows are visible/modifiable
                            </div>
                        </div>
                    )}

                    {shouldShowWithCheck() && (
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                                WITH CHECK Expression (Optional)
                            </label>
                            <textarea
                                value={withCheckExpression}
                                onChange={(e) => setWithCheckExpression(e.target.value)}
                                placeholder="e.g., status = 'active'"
                                rows={4}
                                style={{
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    backgroundColor: 'var(--vscode-input-background)',
                                    color: 'var(--vscode-input-foreground)',
                                    border: '1px solid var(--vscode-input-border)',
                                    padding: '8px',
                                    borderRadius: '3px',
                                    fontSize: '13px',
                                    fontFamily: 'var(--vscode-font-family)',
                                    resize: 'vertical'
                                }}
                            />
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginTop: '4px'
                            }}>
                                For INSERT/UPDATE: boolean expression to check new rows (defaults to USING expression)
                            </div>
                        </div>
                    )}
                </div>
            </Section>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Update Policy"
                loading={isSubmitting}
                saveDisabled={isSubmitting || !hasChanges()}
            />
        </div>
    );
};

