import React, { useState, useEffect } from 'react';
import { 
    Input, 
    Select, 
    Section, 
    ActionButtons,
    SqlPreview,
    Button,
    useScrollToError
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

interface ColumnDefinition {
    name: string;
    dataType: string;
    length?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    isUnique: boolean;
    comment?: string;
}

interface TableDefinition {
    schema: string;
    tableName: string;
    owner?: string;
    columns: ColumnDefinition[];
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const DATA_TYPES = [
    'INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL',
    'VARCHAR', 'CHAR', 'TEXT',
    'BOOLEAN',
    'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME', 'TIMETZ',
    'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION',
    'JSON', 'JSONB',
    'UUID',
    'BYTEA',
    'ARRAY'
];

export const CreateTableView: React.FC = () => {
    const [tableName, setTableName] = useState('');
    const [owner, setOwner] = useState('');
    const [columns, setColumns] = useState<ColumnDefinition[]>([{
        name: 'id',
        dataType: 'SERIAL',
        nullable: false,
        isPrimaryKey: true,
        isUnique: false
    }]);
    const [error, setError] = useState('');
    const [validationError, setValidationError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [sqlPreview, setSqlPreview] = useState('-- Add columns to see SQL preview');
    const [showPreview, setShowPreview] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    const initialData = (window as any).initialData;
    const errorRef = useScrollToError(error);
    const schema = initialData?.schema || 'public';
    const database = initialData?.database || '';
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
        if (tableName || columns.some(col => col.name)) {
            updatePreview();
        }
    }, [tableName, owner, columns]);

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
            tableDefinition: {
                schema,
                tableName,
                owner,
                columns
            }
        });
    };

    const addColumn = () => {
        setColumns([...columns, {
            name: '',
            dataType: 'TEXT',
            nullable: true,
            isPrimaryKey: false,
            isUnique: false
        }]);
    };

    const removeColumn = (index: number) => {
        if (columns.length > 1) {
            setColumns(columns.filter((_, i) => i !== index));
        }
    };

    const updateColumn = (index: number, field: keyof ColumnDefinition, value: any) => {
        const newColumns = [...columns];
        
        // If setting isPrimaryKey to true, automatically set nullable to false
        if (field === 'isPrimaryKey' && value === true) {
            newColumns[index] = { ...newColumns[index], [field]: value, nullable: false };
        } else {
            newColumns[index] = { ...newColumns[index], [field]: value };
        }
        
        setColumns(newColumns);
    };

    const validateTableName = (name: string): string => {
        if (!name.trim()) {
            return 'Table name is required';
        }

        if (!/^[a-z_][a-z0-9_]*$/i.test(name.trim())) {
            return 'Table name must start with a letter or underscore and contain only letters, numbers, and underscores';
        }

        return '';
    };

    const handleTableNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setTableName(value);
        
        // Only show validation error if the user has typed something
        if (value.trim()) {
            const error = validateTableName(value);
            setValidationError(error);
        } else {
            setValidationError('');
        }
    };

    const validateTable = (): boolean => {
        setError('');

        const validationErr = validateTableName(tableName);
        if (validationErr) {
            setError(validationErr);
            setValidationError(validationErr);
            return false;
        }

        if (columns.length === 0) {
            setError('At least one column is required');
            return false;
        }

        const validColumns = columns.filter(col => col.name && col.dataType);
        if (validColumns.length === 0) {
            setError('At least one column with name and data type is required');
            return false;
        }

        // Check for duplicate column names
        const columnNames = validColumns.map(col => col.name.toLowerCase());
        const duplicates = columnNames.filter((name, index) => columnNames.indexOf(name) !== index);
        if (duplicates.length > 0) {
            setError(`Duplicate column names: ${duplicates.join(', ')}`);
            return false;
        }

        return true;
    };

    const handleCreate = () => {
        if (!validateTable()) {
            return;
        }

        setIsSubmitting(true);
        vscode.postMessage({
            command: 'createTable',
            tableDefinition: {
                schema,
                tableName,
                owner,
                columns: columns.filter(col => col.name && col.dataType)
            }
        });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    const getDefaultPlaceholder = (dataType: string): string => {
        const type = dataType.toUpperCase();
        if (type.includes('INT') || type.includes('SERIAL')) {
            return '0';
        } else if (type.includes('VARCHAR') || type.includes('CHAR') || type === 'TEXT') {
            return "'default text'";
        } else if (type.includes('TIMESTAMP') || type === 'DATE' || type.includes('TIME')) {
            return 'NOW()';
        } else if (type === 'BOOLEAN') {
            return 'false';
        } else if (type.includes('NUMERIC') || type.includes('DECIMAL') || type.includes('REAL') || type.includes('DOUBLE')) {
            return '0.0';
        } else if (type === 'UUID') {
            return 'gen_random_uuid()';
        } else if (type === 'JSON' || type === 'JSONB') {
            return "'{}'";
        } else {
            return 'NULL';
        }
    };

    const getLengthPlaceholder = (dataType: string): string => {
        const type = dataType.toUpperCase();
        if (type.includes('VARCHAR')) {
            return '255';
        } else if (type.includes('CHAR')) {
            return '10';
        } else if (type.includes('NUMERIC') || type.includes('DECIMAL')) {
            return '10,2';
        } else {
            return '';
        }
    };

    const shouldShowLength = (dataType: string): boolean => {
        const type = dataType.toUpperCase();
        return type.includes('VARCHAR') || 
               type.includes('CHAR') || 
               type.includes('NUMERIC') || 
               type.includes('DECIMAL');
    };

    const hasLengthColumn = (): boolean => {
        return columns.some(col => {
            const type = col.dataType.toUpperCase();
            return type.includes('VARCHAR') || type.includes('CHAR');
        });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '1200px', margin: '0 auto' }}>
            <h1 style={componentStyles.panelTitle}>
                Create Table in {schema}
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
                    label="Table Name"
                    value={tableName}
                    onChange={handleTableNameChange}
                    error={validationError}
                    fullWidth={true}
                    style={{ maxWidth: '500px' }}
                    required
                />

                <Select
                    label="Owner"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    options={existingRoles.map((role: string) => ({ value: role, label: role }))}
                    fullWidth={true}
                    style={{ maxWidth: '500px' }}
                    disabled={true}
                />
            </Section>

            <Section 
                title="Columns"
                headerActions={
                    <Button 
                        variant="secondary" 
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        size="sm"
                        style={{ backgroundColor: 'transparent', border: 'none' }}
                    >
                        <span style={{ marginRight: '4px' }}>{showAdvanced ? '▼' : '▶'}</span>
                        {showAdvanced ? 'Hide' : 'Show'} Advanced Options
                    </Button>
                }
            >
                <div style={{ 
                    overflowX: 'auto',
                    overflowY: 'auto',
                    maxHeight: 'calc(12 * 42px + 42px)', // 12 rows * ~42px per row + header height
                }}>
                    <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        marginTop: spacing.sm
                    }}>
                        <thead>
                            <tr style={{ backgroundColor: 'var(--vscode-editor-background)' }}>
                                <th style={headerCellStyle}>Column Name</th>
                                <th style={headerCellStyle}>Data Type</th>
                                <th style={{...headerCellStyle, textAlign: 'center'}}>Nullable</th>
                                <th style={{...headerCellStyle, textAlign: 'center'}}>Unique</th>
                                <th style={{...headerCellStyle, textAlign: 'center'}}>Primary Key</th>
                                {showAdvanced && hasLengthColumn() && <th style={headerCellStyle}>Length</th>}
                                {showAdvanced && <th style={headerCellStyle}>Default</th>}
                                {showAdvanced && <th style={headerCellStyle}>Comment</th>}
                                <th style={headerCellStyle}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {columns.map((column, index) => (
                                <tr key={index} style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}>
                                    <td style={cellStyle}>
                                        <Input
                                            value={column.name}
                                            onChange={(e) => updateColumn(index, 'name', e.target.value)}
                                            fullWidth={true}
                                            noWrapper={true}
                                            style={{ minWidth: '180px', maxWidth: '500px' }}
                                        />
                                    </td>
                                    <td style={cellStyle}>
                                        <Select
                                            value={column.dataType}
                                            onChange={(e) => updateColumn(index, 'dataType', e.target.value)}
                                            options={DATA_TYPES.map(type => ({ value: type, label: type }))}
                                            fullWidth={true}
                                            noWrapper={true}
                                            style={{ minWidth: '180px', maxWidth: '500px' }}
                                        />
                                    </td>
                                    <td style={cellStyle}>
                                        <div style={{ textAlign: 'center' }}>
                                            <input
                                                type="checkbox"
                                                checked={column.nullable}
                                                onChange={(e) => updateColumn(index, 'nullable', e.target.checked)}
                                                disabled={column.isPrimaryKey}
                                                style={{ cursor: column.isPrimaryKey ? 'not-allowed' : 'pointer' }}
                                            />
                                        </div>
                                    </td>
                                    <td style={cellStyle}>
                                        <div style={{ textAlign: 'center' }}>
                                            <input
                                                type="checkbox"
                                                checked={column.isUnique}
                                                onChange={(e) => updateColumn(index, 'isUnique', e.target.checked)}
                                                style={{ cursor: 'pointer' }}
                                            />
                                        </div>
                                    </td>
                                    <td style={cellStyle}>
                                        <div style={{ textAlign: 'center' }}>
                                            <input
                                                type="checkbox"
                                                checked={column.isPrimaryKey}
                                                onChange={(e) => updateColumn(index, 'isPrimaryKey', e.target.checked)}
                                                style={{ cursor: 'pointer' }}
                                            />
                                        </div>
                                    </td>
                                    {showAdvanced && hasLengthColumn() && (
                                        <td style={cellStyle}>
                                            <Input
                                                type="number"
                                                value={column.length?.toString() || ''}
                                                onChange={(e) => updateColumn(index, 'length', e.target.value ? parseInt(e.target.value) : undefined)}
                                                placeholder={getLengthPlaceholder(column.dataType)}
                                                fullWidth={true}
                                                noWrapper={true}
                                                style={{ minWidth: '80px', maxWidth: '120px' }}
                                                disabled={!shouldShowLength(column.dataType)}
                                            />
                                        </td>
                                    )}
                                    {showAdvanced && (
                                        <td style={cellStyle}>
                                            <Input
                                                value={column.defaultValue || ''}
                                                onChange={(e) => updateColumn(index, 'defaultValue', e.target.value)}
                                                fullWidth={true}
                                                noWrapper={true}
                                                style={{ minWidth: '80px', maxWidth: '120px' }}
                                            />
                                        </td>
                                    )}
                                    {showAdvanced && (
                                        <td style={cellStyle}>
                                            <Input
                                                value={column.comment || ''}
                                                onChange={(e) => updateColumn(index, 'comment', e.target.value)}
                                                fullWidth={true}
                                                noWrapper={true}
                                                style={{ minWidth: '180px', maxWidth: '500px' }}
                                            />
                                        </td>
                                    )}
                                    <td style={cellStyle}>
                                        <Button
                                            variant="secondary"
                                            onClick={() => removeColumn(index)}
                                            disabled={columns.length === 1}
                                            size="sm"
                                        >
                                            Remove
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ marginTop: spacing.md }}>
                    <Button variant="secondary" onClick={addColumn}>
                        + Add Column
                    </Button>
                </div>
            </Section>

            <SqlPreview sql={sqlPreview} defaultOpen={showPreview} />

            <ActionButtons
                onSave={handleCreate}
                onCancel={handleCancel}
                saveLabel="Create Table"
                saveDisabled={isSubmitting}
                loading={isSubmitting}
                loadingText="Creating..."
            />
        </div>
    );
};

const headerCellStyle: React.CSSProperties = {
    padding: spacing.sm,
    textAlign: 'left',
    fontWeight: 600,
    borderBottom: '2px solid var(--vscode-panel-border)',
    whiteSpace: 'nowrap'
};

const cellStyle: React.CSSProperties = {
    padding: spacing.sm,
    verticalAlign: 'middle'
};

