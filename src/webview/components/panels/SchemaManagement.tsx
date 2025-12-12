import React, { useState, useEffect } from 'react';
import { 
    Input, 
    Select, 
    Section, 
    ActionButtons,
    SqlPreview,
    useScrollToError
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

interface SchemaManagementProps {
    mode: 'create' | 'edit';
    existingRoles: string[];
    currentUser: string;
    currentSchemaName?: string;
    currentOwner?: string;
}

interface SchemaDefinition {
    name: string;
    owner: string;
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

export const CreateSchemaView: React.FC = () => {
    const [schemaName, setSchemaName] = useState('');
    const [owner, setOwner] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sqlPreview, setSqlPreview] = useState('-- Generating SQL preview...');
    const [showPreview, setShowPreview] = useState(false);
    
    const initialData = (window as any).initialData;
    const errorRef = useScrollToError(error);
    const existingRoles = initialData?.existingRoles || [];
    const currentUser = initialData?.currentUser || '';

    useEffect(() => {
        // Set default owner to current user
        if (currentUser && !owner) {
            setOwner(currentUser);
        }
    }, [currentUser]);

    useEffect(() => {
        // Update SQL preview whenever inputs change
        if (schemaName || owner) {
            updatePreview();
        }
    }, [schemaName, owner]);

    useEffect(() => {
        // Listen for messages from extension
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
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    const updatePreview = () => {
        vscode.postMessage({
            command: 'previewSql',
            schemaDef: {
                name: schemaName,
                owner: owner
            }
        });
    };

    const validateSchema = (): boolean => {
        setError('');

        if (!schemaName.trim()) {
            setError('Schema name is required');
            return false;
        }

        if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
            setError('Schema name must start with a letter or underscore and contain only letters, numbers, and underscores');
            return false;
        }

        // Check for reserved prefixes
        const reserved = ['pg_', 'information_schema', 'pg_catalog', 'pg_toast'];
        if (reserved.some(r => schemaName.toLowerCase().startsWith(r.toLowerCase()))) {
            setError('Cannot use reserved schema name prefix');
            return false;
        }

        return true;
    };

    const handleCreate = () => {
        if (!validateSchema()) {
            return;
        }

        setIsSubmitting(true);
        vscode.postMessage({
            command: 'createSchema',
            schemaDef: {
                name: schemaName,
                owner: owner
            }
        });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto' }}>
            <h1 style={componentStyles.panelTitle}>
                Create Schema
            </h1>

            {error && (
                <div 
                    ref={errorRef}
                    style={{
                        padding: '12px',
                        marginBottom: '16px',
                        backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
                        border: '1px solid var(--vscode-inputValidation-errorBorder)',
                        borderRadius: '4px',
                        color: 'var(--vscode-inputValidation-errorForeground)'
                    }}
                >
                    {error}
                </div>
            )}

            <Section>
                <Input
                    label="Schema Name"
                    value={schemaName}
                    onChange={(e) => setSchemaName(e.target.value)}
                    helperText="Must start with a letter or underscore and contain only letters, numbers, and underscores. Cannot use reserved prefixes (pg_, information_schema)."
                    error={error && schemaName ? undefined : error}
                    fullWidth={true}
                />

                <Select
                    label="Owner"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    options={existingRoles.map((role: string) => ({ value: role, label: role }))}
                    helperText="Only the database owner or roles in which the database owner is a member can be selected"
                    fullWidth={true}
                />
            </Section>

            <SqlPreview sql={sqlPreview} defaultOpen={showPreview} />

            <ActionButtons
                onSave={handleCreate}
                onCancel={handleCancel}
                saveLabel="Create Schema"
                saveDisabled={isSubmitting}
                loading={isSubmitting}
                loadingText="Creating..."
            />
        </div>
    );
};

export const EditSchemaView: React.FC = () => {
    const initialData = (window as any).initialData;
    const existingRoles = initialData?.existingRoles || [];
    const originalSchemaName = initialData?.currentSchemaName || '';
    const currentOwner = initialData?.currentOwner || '';

    const [schemaName, setSchemaName] = useState(originalSchemaName);
    const [owner, setOwner] = useState(currentOwner);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sqlPreview, setSqlPreview] = useState('-- Generating SQL preview...');
    const [showPreview, setShowPreview] = useState(false);

    const errorRef = useScrollToError(error);

    useEffect(() => {
        // Update SQL preview whenever inputs change
        if (schemaName || owner) {
            updatePreview();
        }
    }, [schemaName, owner]);

    useEffect(() => {
        // Listen for messages from extension
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
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    const updatePreview = () => {
        vscode.postMessage({
            command: 'previewSql',
            schemaDef: {
                name: schemaName,
                owner: owner,
                originalName: originalSchemaName,
                originalOwner: currentOwner
            }
        });
    };

    const hasChanges = (): boolean => {
        // Only check schema name since owner field is disabled
        return schemaName !== originalSchemaName;
    };

    const validateSchema = (): boolean => {
        setError('');

        if (!schemaName.trim()) {
            setError('Schema name is required');
            return false;
        }

        if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
            setError('Schema name must start with a letter or underscore and contain only letters, numbers, and underscores');
            return false;
        }

        // Check for reserved prefixes
        const reserved = ['pg_', 'information_schema', 'pg_catalog', 'pg_toast'];
        if (reserved.some(r => schemaName.toLowerCase().startsWith(r.toLowerCase()))) {
            setError('Cannot use reserved schema name prefix');
            return false;
        }

        return true;
    };

    const handleEdit = () => {
        if (!validateSchema()) {
            return;
        }

        setIsSubmitting(true);
        vscode.postMessage({
            command: 'editSchema',
            schemaDef: {
                name: schemaName,
                owner: owner,
                originalName: originalSchemaName,
                originalOwner: currentOwner
            }
        });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto' }}>
            <h1 style={componentStyles.panelTitle}>
                Edit Schema: {originalSchemaName}
            </h1>

            {error && (
                <div 
                    ref={errorRef}
                    style={{
                        padding: '12px',
                        marginBottom: '16px',
                        backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
                        border: '1px solid var(--vscode-inputValidation-errorBorder)',
                        borderRadius: '4px',
                        color: 'var(--vscode-inputValidation-errorForeground)'
                    }}
                >
                    {error}
                </div>
            )}

            <Section>
                <Input
                    label="Schema Name"
                    value={schemaName}
                    onChange={(e) => setSchemaName(e.target.value)}
                    helperText="Must start with a letter or underscore and contain only letters, numbers, and underscores. Cannot use reserved prefixes (pg_, information_schema)."
                    error={error && schemaName ? undefined : error}
                    fullWidth={true}
                />

                <Select
                    label="Owner"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    options={existingRoles.map((role: string) => ({ value: role, label: role }))}
                    fullWidth={true}
                    disabled={true}
                />
            </Section>

            <SqlPreview sql={sqlPreview} defaultOpen={showPreview} />

            <ActionButtons
                onSave={handleEdit}
                onCancel={handleCancel}
                saveLabel="Update Schema"
                saveDisabled={isSubmitting || !hasChanges()}
                loading={isSubmitting}
                loadingText="Updating..."
            />
        </div>
    );
};

