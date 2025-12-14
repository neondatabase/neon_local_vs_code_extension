import React, { useState, useEffect } from 'react';
import {
    Input,
    Select,
    Section,
    ActionButtons,
    SqlPreview,
    CollapsibleSection,
    useScrollToError,
    Checkbox
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

interface IndexDefinition {
    indexName: string;
    tableName: string;
    schema: string;
    columns: string[];
    indexType: string;
    unique: boolean;
    concurrent: boolean;
    whereClause?: string;
}

interface CreateIndexProps {
    schema: string;
    tableName: string;
    columns: string[];
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const INDEX_TYPES = [
    { value: 'btree', label: 'B-tree (Default - Most Common)' },
    { value: 'hash', label: 'Hash (Equality Only)' },
    { value: 'gin', label: 'GIN (Full-text/JSONB)' },
    { value: 'brin', label: 'BRIN (Large Tables)' }
];

const INDEX_TYPE_DESCRIPTIONS: Record<string, string> = {
    'btree': 'B-tree is the default and most versatile index type. It handles equality and range queries efficiently (<, <=, =, >=, >), making it suitable for most use cases including sorting and pattern matching with LIKE.',
    'hash': 'Hash indexes are optimized for simple equality comparisons (=) only. They are faster than B-tree for exact matches but cannot handle range queries, sorting, or pattern matching. Use when you only need equality lookups.',
    'gin': 'GIN (Generalized Inverted Index) is designed for indexing composite values like arrays, JSONB documents, and full-text search. Ideal for queries using operators like @>, ?, ?&, ?|, and @@ (text search).',
    'brin': 'BRIN (Block Range Index) is extremely space-efficient for very large tables where data has natural ordering (like timestamps or sequential IDs). It stores summaries of value ranges per block, trading query speed for minimal storage.'
};

export const CreateIndexComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as CreateIndexProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const availableColumns = initialData.columns || [];
    
    const [indexName, setIndexName] = useState('');
    const [indexType, setIndexType] = useState('btree');
    const [unique, setUnique] = useState(false);
    const [concurrent, setConcurrent] = useState(false);
    const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
    const [whereClause, setWhereClause] = useState('');

    const [error, setError] = useState('');
    const [validationError, setValidationError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    const validateIndexName = (name: string): string => {
        if (!name.trim()) {
            return 'Index name is required';
        }
        
        // Check for valid PostgreSQL identifier
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            return 'Index name must start with a letter or underscore and contain only letters, numbers, and underscores';
        }
        
        // Check for reserved prefixes
        if (name.toLowerCase().startsWith('pg_')) {
            return 'Index name cannot start with "pg_" (reserved prefix)';
        }
        
        return '';
    };

    const handleIndexNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        setIndexName(newName);
        setValidationError(validateIndexName(newName));
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
        if (indexName && selectedColumns.length > 0) {
            const indexDef: IndexDefinition = {
                indexName,
                tableName,
                schema,
                columns: selectedColumns,
                indexType,
                unique,
                concurrent,
                whereClause: whereClause || undefined
            };
            vscode.postMessage({ command: 'previewSql', indexDef });
        } else {
            setSqlPreview('');
        }
    }, [indexName, tableName, schema, selectedColumns, indexType, unique, concurrent, whereClause]);

    const handleColumnToggle = (columnName: string) => {
        setSelectedColumns(prev => {
            if (prev.includes(columnName)) {
                return prev.filter(col => col !== columnName);
            } else {
                return [...prev, columnName];
            }
        });
    };

    const handleSubmit = () => {
        const nameError = validateIndexName(indexName);
        if (nameError) {
            setError(nameError);
            setValidationError(nameError);
            return;
        }

        if (selectedColumns.length === 0) {
            setError('At least one column must be selected');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const indexDef: IndexDefinition = {
            indexName,
            tableName,
            schema,
            columns: selectedColumns,
            indexType,
            unique,
            concurrent,
            whereClause: whereClause || undefined
        };

        vscode.postMessage({ command: 'createIndex', indexDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create Index on {schema}.{tableName}
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

            <Section title="Index Details">
                <Input
                    label="Index Name"
                    value={indexName}
                    onChange={handleIndexNameChange}
                    error={validationError}
                    required
                />

                <Select
                    label="Index Type"
                    value={indexType}
                    onChange={(e) => setIndexType(e.target.value)}
                    options={INDEX_TYPES}
                    helperText={INDEX_TYPE_DESCRIPTIONS[indexType] || 'Select an index type'}
                />

                <Checkbox
                    label="Unique Index"
                    checked={unique}
                    onChange={(e) => setUnique(e.target.checked)}
                    labelTooltip="Ensures all values in the indexed columns are unique"
                />

                <Checkbox
                    label="Create Concurrently"
                    checked={concurrent}
                    onChange={(e) => setConcurrent(e.target.checked)}
                    labelTooltip="Allows reads/writes during index creation (slower but non-blocking)"
                />
            </Section>

            <Section 
                title="Select Columns"
                description="Select columns in the order they should appear in the index"
            >

                    <div style={{
                        border: '1px solid var(--vscode-input-border)',
                        borderRadius: '3px',
                        padding: spacing.sm,
                        maxHeight: '200px',
                        overflowY: 'auto',
                        backgroundColor: 'var(--vscode-input-background)'
                    }}>
                        {availableColumns.map(col => (
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
                                onClick={() => handleColumnToggle(col)}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedColumns.includes(col)}
                                    onChange={() => handleColumnToggle(col)}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <label style={{ cursor: 'pointer', margin: 0 }}>{col}</label>
                            </div>
                        ))}
                    </div>

                    <div style={{
                        marginTop: spacing.sm,
                        padding: spacing.sm,
                        backgroundColor: 'var(--vscode-textCodeBlock-background)',
                        borderRadius: '3px',
                        minHeight: '30px'
                    }}>
                        {selectedColumns.length === 0 ? (
                            <span style={{ color: 'var(--vscode-descriptionForeground)', fontSize: '12px' }}>
                                No columns selected
                            </span>
                        ) : (
                            selectedColumns.map(col => (
                                <span
                                    key={col}
                                    style={{
                                        display: 'inline-block',
                                        backgroundColor: 'var(--vscode-badge-background)',
                                        color: 'var(--vscode-badge-foreground)',
                                        padding: '4px 8px',
                                        margin: '2px',
                                        borderRadius: '12px',
                                        fontSize: '12px'
                                    }}
                                >
                                    {col}
                                </span>
                            ))
                        )}
                    </div>
            </Section>

            <CollapsibleSection title="Advanced Options" defaultOpen={false}>
                <Input
                    label="WHERE Clause (Partial Index)"
                    value={whereClause}
                    onChange={(e) => setWhereClause(e.target.value)}
                    placeholder="e.g., status = 'active'"
                    labelTooltip="Index only rows that match this condition (smaller, faster index)"
                />
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Create Index"
                loading={isSubmitting}
            />
        </div>
    );
};

