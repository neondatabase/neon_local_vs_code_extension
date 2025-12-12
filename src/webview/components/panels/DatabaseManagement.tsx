import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
    Input,
    Select,
    Button,
    Alert,
    ActionButtons,
    Section,
    useScrollToError
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

interface DatabaseDefinition {
    name: string;
    owner: string;
    encoding: string;
}

interface CreateDatabaseViewProps {
    existingRoles: string[];
    currentUser: string;
}

const CreateDatabaseView: React.FC<CreateDatabaseViewProps> = ({ existingRoles, currentUser }) => {
    const [dbName, setDbName] = useState('');
    const [owner, setOwner] = useState(currentUser);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    // Listen for messages from extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'error':
                    setError(message.error);
                    setIsSubmitting(false);
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const getDatabaseDefinition = (): DatabaseDefinition => {
        return {
            name: dbName || 'mydb',
            owner: owner,
            encoding: 'UTF8',
        };
    };

    const validateDatabase = (): string | null => {
        const name = dbName.trim();

        if (!name) {
            return 'Database name is required';
        }

        if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
            return 'Database name must start with a letter or underscore and contain only letters, numbers, and underscores';
        }

        return null;
    };

    const handleCreate = () => {
        const validationError = validateDatabase();
        if (validationError) {
            setError(validationError);
            return;
        }

        setError('');
        setIsSubmitting(true);

        vscode.postMessage({
            command: 'createDatabase',
            dbDef: getDatabaseDefinition(),
        });
    };

    const handleCancel = () => {
        vscode.postMessage({
            command: 'cancel',
        });
    };

    return (
        <div style={layouts.container}>
            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                <h1 style={componentStyles.panelTitle}>
                    Create Database
                </h1>

                {error && (
                    <Alert ref={errorRef} type="error" onClose={() => setError('')}>
                        {error}
                    </Alert>
                )}

                <Section>
                <Input
                    label="Database Name"
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    helperText="Must contain only letters, numbers, and underscores"
                    error={error && dbName ? undefined : error}
                    fullWidth={true}
                />

                    <div>
                        <Select
                            label="Owner"
                            value={owner}
                            onChange={(e) => setOwner(e.target.value)}
                            options={existingRoles.map((role) => ({ value: role, label: role }))}
                            fullWidth={true}
                        />
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginTop: spacing.xs
                        }}>
                            The database owner role
                        </div>
                    </div>
                </Section>

            <ActionButtons
                onSave={handleCreate}
                onCancel={handleCancel}
                saveLabel="Create Database"
                saveDisabled={isSubmitting}
                loading={isSubmitting}
                loadingText="Creating..."
            />
            </div>
        </div>
    );
};

// Mount the React app
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);

    // Get initial data from window (passed from extension)
    const initialData = (window as any).initialData || { existingRoles: [], currentUser: '' };

    root.render(
        <CreateDatabaseView
            existingRoles={initialData.existingRoles}
            currentUser={initialData.currentUser}
        />
    );
}

