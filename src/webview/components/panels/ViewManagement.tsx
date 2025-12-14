import React, { useState, useEffect } from 'react';
import {
    Input,
    Select,
    Section,
    ActionButtons,
    SqlPreview,
    Button,
    useScrollToError,
    Checkbox
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

interface ViewDefinition {
    viewName: string;
    schema: string;
    sqlDefinition: string;
    materialized: boolean;
    replaceIfExists: boolean;
    owner?: string;
    originalViewName?: string;
}

interface ViewManagementProps {
    schema: string;
    viewName?: string;
    definition?: string;
    isMaterialized?: boolean;
    owner?: string;
    tables: string[];
    existingRoles: string[];
    currentUser: string;
    mode: 'create' | 'edit';
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

export const CreateViewComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ViewManagementProps;

    const [schema] = useState(initialData.schema || '');
    const [viewName, setViewName] = useState('');
    const [sqlDefinition, setSqlDefinition] = useState('');
    const [materialized, setMaterialized] = useState(false);
    const [replaceIfExists, setReplaceIfExists] = useState(true);
    const [owner, setOwner] = useState(initialData.currentUser || '');
    const [tables] = useState(initialData.tables || []);
    const [existingRoles] = useState(initialData.existingRoles || []);

    const [error, setError] = useState('');
    const [validationError, setValidationError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    const validateViewName = (name: string): string => {
        if (!name.trim()) {
            return 'View name is required';
        }
        
        // Check for valid PostgreSQL identifier
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            return 'View name must start with a letter or underscore and contain only letters, numbers, and underscores';
        }
        
        // Check for reserved prefixes
        if (name.toLowerCase().startsWith('pg_')) {
            return 'View name cannot start with "pg_" (reserved prefix)';
        }
        
        return '';
    };

    const handleViewNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        setViewName(newName);
        setValidationError(validateViewName(newName));
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
        if (viewName && sqlDefinition) {
            const viewDef: ViewDefinition = {
                schema,
                viewName,
                sqlDefinition,
                materialized,
                replaceIfExists: materialized ? false : replaceIfExists,
                owner: owner || undefined
            };
            vscode.postMessage({ command: 'previewSql', viewDef });
        } else {
            setSqlPreview('');
        }
    }, [schema, viewName, sqlDefinition, materialized, replaceIfExists, owner]);

    const handleInsertTable = (tableName: string) => {
        const textToInsert = `SELECT * FROM ${schema}.${tableName}`;
        setSqlDefinition(prev => prev ? `${prev}\n${textToInsert}` : textToInsert);
    };

    const handleSubmit = () => {
        const nameError = validateViewName(viewName);
        if (nameError) {
            setError(nameError);
            setValidationError(nameError);
            return;
        }

        if (!sqlDefinition.trim()) {
            setError('SQL definition is required');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const viewDef: ViewDefinition = {
            schema,
            viewName,
            sqlDefinition,
            materialized,
            replaceIfExists: materialized ? false : replaceIfExists,
            owner: owner || undefined
        };

        vscode.postMessage({ command: 'createView', viewDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create View in {schema}
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

            <Section title="View Details">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="View Name"
                        value={viewName}
                        onChange={handleViewNameChange}
                        error={validationError}
                        required
                    />

                    <Select
                        label="Owner"
                        value={owner}
                        onChange={(e) => setOwner(e.target.value)}
                        options={existingRoles.map(role => ({ value: role, label: role }))}
                        disabled={true}
                    />

                    <Checkbox
                        label="Materialized View"
                        checked={materialized}
                        onChange={(e) => {
                            setMaterialized(e.target.checked);
                            if (e.target.checked) {
                                setReplaceIfExists(false);
                            }
                        }}
                        labelTooltip="Materialized views store query results and must be refreshed"
                    />

                    {!materialized && (
                        <Checkbox
                            label="Replace if Exists"
                            checked={replaceIfExists}
                            onChange={(e) => setReplaceIfExists(e.target.checked)}
                            labelTooltip="Use CREATE OR REPLACE (not available for materialized views)"
                        />
                    )}
                </div>
            </Section>

            <Section title="SQL Definition">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: '13px',
                            fontWeight: '500',
                            marginBottom: spacing.xs
                        }}>
                            SELECT Statement <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                        </label>
                        <textarea
                            value={sqlDefinition}
                            onChange={(e) => setSqlDefinition(e.target.value)}
                            placeholder="SELECT * FROM table_name WHERE condition"
                            style={{
                                width: '100%',
                                minHeight: '200px',
                                padding: spacing.sm,
                                fontSize: '13px',
                                backgroundColor: 'var(--vscode-input-background)',
                                color: 'var(--vscode-input-foreground)',
                                border: '1px solid var(--vscode-input-border)',
                                borderRadius: '4px',
                                outline: 'none',
                                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                                resize: 'vertical',
                                boxSizing: 'border-box'
                            }}
                        />
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginTop: spacing.xs
                        }}>
                            Enter the SELECT statement that defines your view
                        </div>
                    </div>

                    {tables.length > 0 && (
                        <div>
                            <div style={{
                                fontSize: '13px',
                                fontWeight: '500',
                                marginBottom: spacing.xs
                            }}>
                                Available Tables
                            </div>
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: spacing.xs,
                                padding: spacing.sm,
                                backgroundColor: 'var(--vscode-editor-background)',
                                borderRadius: '4px'
                            }}>
                                {tables.map(table => (
                                    <button
                                        key={table}
                                        onClick={() => handleInsertTable(table)}
                                        style={{
                                            padding: `${spacing.xs} ${spacing.sm}`,
                                            backgroundColor: 'var(--vscode-button-secondaryBackground)',
                                            color: 'var(--vscode-button-secondaryForeground)',
                                            border: 'none',
                                            borderRadius: '3px',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                            transition: 'background-color 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryHoverBackground)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
                                        }}
                                    >
                                        {table}
                                    </button>
                                ))}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginTop: spacing.xs
                            }}>
                                Click a table name to insert a SELECT statement
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
                saveLabel="Create View"
                loading={isSubmitting}
            />
        </div>
    );
};

export const EditViewComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ViewManagementProps;

    const [schema] = useState(initialData.schema || '');
    const [originalViewName] = useState(initialData.viewName || '');
    const [viewName, setViewName] = useState(initialData.viewName || '');
    const [sqlDefinition, setSqlDefinition] = useState(initialData.definition || '');
    const [materialized] = useState(initialData.isMaterialized || false);
    const [owner, setOwner] = useState(initialData.owner || initialData.currentUser || '');
    const [tables] = useState(initialData.tables || []);
    const [existingRoles] = useState(initialData.existingRoles || []);

    // Store original values for change detection
    const originalSqlDefinition = initialData.definition || '';

    const [error, setError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    // Check if any changes have been made
    const hasChanges = (): boolean => {
        if (viewName !== originalViewName) return true;
        if (sqlDefinition !== originalSqlDefinition) return true;
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

        if (viewName && sqlDefinition) {
            const viewDef: ViewDefinition = {
                schema,
                viewName,
                sqlDefinition,
                materialized,
                replaceIfExists: false,
                owner: owner || undefined,
                originalViewName
            };
            vscode.postMessage({ command: 'previewSql', viewDef });
        } else {
            setSqlPreview('');
        }
    }, [schema, viewName, sqlDefinition, materialized, owner, originalViewName]);

    const handleInsertTable = (tableName: string) => {
        const textToInsert = `SELECT * FROM ${schema}.${tableName}`;
        setSqlDefinition(prev => prev ? `${prev}\n${textToInsert}` : textToInsert);
    };

    const handleSubmit = () => {
        if (!viewName.trim()) {
            setError('View name is required');
            return;
        }

        if (!sqlDefinition.trim()) {
            setError('SQL definition is required');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const viewDef: ViewDefinition = {
            schema,
            viewName,
            sqlDefinition,
            materialized,
            replaceIfExists: false,
            owner: owner || undefined,
            originalViewName
        };

        vscode.postMessage({ command: 'updateView', viewDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Edit {materialized ? 'Materialized ' : ''}View: {schema}.{originalViewName}
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

            <Section title="View Details">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Schema"
                        value={schema}
                        readOnly
                        helperText="The schema where this view exists"
                    />

                    <Input
                        label="View Name"
                        value={viewName}
                        onChange={(e) => setViewName(e.target.value)}
                        placeholder="my_view"
                        helperText="Naming convention: lowercase with underscores"
                        required
                    />

                    <Select
                        label="Owner"
                        value={owner}
                        onChange={(e) => setOwner(e.target.value)}
                        options={existingRoles.map(role => ({ value: role, label: role }))}
                        disabled={true}
                    />

                    <div style={{
                        padding: spacing.md,
                        backgroundColor: 'var(--vscode-textBlockQuote-background)',
                        borderLeft: '4px solid var(--vscode-textBlockQuote-border)',
                        borderRadius: '4px'
                    }}>
                        <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: spacing.xs }}>
                            {materialized ? 'Materialized View' : 'Standard View'}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                            {materialized
                                ? 'This is a materialized view. To change the type, drop and recreate the view.'
                                : 'This is a standard view. To change the type, drop and recreate the view.'}
                        </div>
                    </div>
                </div>
            </Section>

            <Section title="SQL Definition">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div>
                        <label style={{
                            display: 'block',
                            fontSize: '13px',
                            fontWeight: '500',
                            marginBottom: spacing.xs
                        }}>
                            SELECT Statement <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                        </label>
                        <textarea
                            value={sqlDefinition}
                            onChange={(e) => setSqlDefinition(e.target.value)}
                            placeholder="SELECT * FROM table_name WHERE condition"
                            style={{
                                width: '100%',
                                minHeight: '200px',
                                padding: spacing.sm,
                                fontSize: '13px',
                                backgroundColor: 'var(--vscode-input-background)',
                                color: 'var(--vscode-input-foreground)',
                                border: '1px solid var(--vscode-input-border)',
                                borderRadius: '4px',
                                outline: 'none',
                                fontFamily: 'var(--vscode-editor-font-family, monospace)',
                                resize: 'vertical',
                                boxSizing: 'border-box'
                            }}
                        />
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginTop: spacing.xs
                        }}>
                            Enter the SELECT statement that defines your view
                        </div>
                    </div>

                    {tables.length > 0 && (
                        <div>
                            <div style={{
                                fontSize: '13px',
                                fontWeight: '500',
                                marginBottom: spacing.xs
                            }}>
                                Available Tables
                            </div>
                            <div style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: spacing.xs,
                                padding: spacing.sm,
                                backgroundColor: 'var(--vscode-editor-background)',
                                borderRadius: '4px'
                            }}>
                                {tables.map(table => (
                                    <button
                                        key={table}
                                        onClick={() => handleInsertTable(table)}
                                        style={{
                                            padding: `${spacing.xs} ${spacing.sm}`,
                                            backgroundColor: 'var(--vscode-button-secondaryBackground)',
                                            color: 'var(--vscode-button-secondaryForeground)',
                                            border: 'none',
                                            borderRadius: '3px',
                                            fontSize: '12px',
                                            cursor: 'pointer',
                                            transition: 'background-color 0.2s'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryHoverBackground)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
                                        }}
                                    >
                                        {table}
                                    </button>
                                ))}
                            </div>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginTop: spacing.xs
                            }}>
                                Click a table name to insert a SELECT statement
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
                saveLabel="Update View"
                loading={isSubmitting}
                saveDisabled={isSubmitting || !hasChanges()}
            />
        </div>
    );
};

