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
    id: number;
    name: string;
    originalName?: string;
    dataType: string;
    length?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    isUnique: boolean;
    comment?: string;
    status: 'existing' | 'new' | 'modified' | 'deleted';
    isDeleted?: boolean;
}

interface EditTableViewProps {
    schema: string;
    tableName: string;
    columns: ColumnDefinition[];
    currentOwner: string;
    existingRoles: string[];
    database?: string;
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const DATA_TYPES = [
    'INTEGER', 'BIGINT', 'SMALLINT',
    'SERIAL', 'BIGSERIAL',
    'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION',
    'VARCHAR', 'CHAR', 'TEXT',
    'BOOLEAN',
    'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ',
    'UUID',
    'JSON', 'JSONB',
    'BYTEA',
    'INET', 'CIDR', 'MACADDR',
    'ARRAY'
];

// Helper function to get allowed data types for a column
// Excludes SERIAL/BIGSERIAL unless the column's original type is SERIAL/BIGSERIAL
const getDataTypesForColumn = (column: ColumnDefinition, originalColumns: ColumnDefinition[]): string[] => {
    // Find the original column to check its data type
    const originalColumn = originalColumns.find(c => c.id === column.id);
    const originalType = originalColumn?.dataType?.toUpperCase() || '';
    
    // If the original type is SERIAL or BIGSERIAL, allow all types
    if (originalType === 'SERIAL' || originalType === 'BIGSERIAL') {
        return DATA_TYPES;
    }
    
    // Otherwise, filter out SERIAL and BIGSERIAL
    return DATA_TYPES.filter(type => type !== 'SERIAL' && type !== 'BIGSERIAL');
};

export const EditTableView: React.FC = () => {
    const initialData = (window as any).initialData;
    
    const [schema, setSchema] = useState(initialData?.schema || '');
    const [tableName, setTableName] = useState(initialData?.tableName || '');
    const [originalTableName, setOriginalTableName] = useState(initialData?.tableName || '');
    const [owner, setOwner] = useState(initialData?.currentOwner || '');
    const [originalOwner, setOriginalOwner] = useState(initialData?.currentOwner || '');
    const [columns, setColumns] = useState<ColumnDefinition[]>(initialData?.columns || []);
    const [originalColumns, setOriginalColumns] = useState<ColumnDefinition[]>(JSON.parse(JSON.stringify(initialData?.columns || [])));
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [sqlPreview, setSqlPreview] = useState('-- Make changes to see the ALTER TABLE statements');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [columnIdCounter, setColumnIdCounter] = useState((initialData?.columns?.length || 0) + 1);
    const [showPreview, setShowPreview] = useState(false);
    const [existingRoles, setExistingRoles] = useState<string[]>(initialData?.existingRoles || []);

    const errorRef = useScrollToError(error);

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'initialize':
                    setSchema(message.schema || '');
                    setTableName(message.tableName || '');
                    setOriginalTableName(message.tableName || '');
                    setOwner(message.currentOwner || '');
                    setOriginalOwner(message.currentOwner || '');
                    setColumns(message.columns || []);
                    setOriginalColumns(JSON.parse(JSON.stringify(message.columns || [])));
                    setExistingRoles(message.existingRoles || []);
                    setColumnIdCounter((message.columns?.length || 0) + 1);
                    break;
                case 'sqlPreview':
                    setSqlPreview(message.sql);
                    break;
                case 'error':
                    setError(message.error);
                    setIsSubmitting(false);
                    break;
                case 'loading':
                    if (message.loading !== undefined) {
                        setIsSubmitting(message.loading);
                    }
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    useEffect(() => {
        updatePreview();
    }, [tableName, owner, columns]);

    const updatePreview = () => {
        const changes = getChanges();
        vscode.postMessage({
            command: 'previewSql',
            changes,
            tableName,
            originalTableName,
            owner,
            originalOwner
        });
    };

    const getChanges = () => {
        const changes: any[] = [];
        
        columns.forEach(col => {
            if (col.status === 'new' && !col.isDeleted) {
                changes.push({
                    action: 'add',
                    newName: col.name,
                    dataType: col.dataType,
                    length: col.length,
                    nullable: col.nullable,
                    defaultValue: col.defaultValue,
                    isPrimaryKey: col.isPrimaryKey,
                    isUnique: col.isUnique,
                    comment: col.comment
                });
            } else if (col.status === 'modified' && !col.isDeleted) {
                // Find the original column to compare what changed
                const original = originalColumns.find(o => o.id === col.id);
                changes.push({
                    action: 'modify',
                    oldName: col.originalName || original?.name,
                    newName: col.name,
                    dataType: col.dataType,
                    length: col.length,
                    nullable: col.nullable,
                    defaultValue: col.defaultValue,
                    isPrimaryKey: col.isPrimaryKey,
                    isUnique: col.isUnique,
                    comment: col.comment,
                    // Include original values so backend can determine what actually changed
                    original: original ? {
                        dataType: original.dataType,
                        length: original.length,
                        nullable: original.nullable,
                        defaultValue: original.defaultValue,
                        isPrimaryKey: original.isPrimaryKey,
                        isUnique: original.isUnique,
                        comment: original.comment
                    } : undefined
                });
            } else if (col.isDeleted) {
                changes.push({
                    action: 'drop',
                    oldName: col.originalName || col.name
                });
            }
        });
        
        return changes;
    };

    const addNewColumn = () => {
        const newColumn: ColumnDefinition = {
            id: columnIdCounter,
            name: '',
            dataType: 'INTEGER',
            nullable: true,
            isPrimaryKey: false,
            isUnique: false,
            defaultValue: '',
            comment: '',
            status: 'new',
            isDeleted: false
        };
        
        setColumns([...columns, newColumn]);
        setColumnIdCounter(columnIdCounter + 1);
    };

    const updateColumn = (id: number, field: string, value: any) => {
        setColumns(columns.map(col => {
            if (col.id === id) {
                const updated = { ...col, [field]: value };
                
                // Handle primary key implications
                if (field === 'isPrimaryKey') {
                    if (value === true) {
                        // Primary keys cannot be nullable
                        updated.nullable = false;
                    } else {
                        // When unchecking primary key, restore original nullable value if available
                        const original = originalColumns.find(o => o.id === col.id);
                        if (original) {
                            updated.nullable = original.nullable;
                        }
                    }
                }
                
                // Check if this is an existing or modified column
                if (col.status === 'existing' || col.status === 'modified') {
                    const original = originalColumns.find(o => o.id === col.id);
                    if (original) {
                        // Check if the column has changed from the original
                        if (hasColumnChanged(updated, original)) {
                            updated.status = 'modified';
                            // Ensure originalName is set for tracking
                            if (!updated.originalName) {
                                updated.originalName = original.name;
                            }
                        } else {
                            // Changed back to match original, revert to existing status
                            updated.status = 'existing';
                        }
                    }
                }
                
                return updated;
            }
            return col;
        }));
    };

    const hasColumnChanged = (col: ColumnDefinition, original: ColumnDefinition) => {
        // Normalize empty values for comparison (treat undefined, null, and empty string as the same)
        const normalizeValue = (val: any) => (val === null || val === undefined || val === '') ? '' : val;
        
        // Normalize data types for comparison (case-insensitive)
        const normalizeDataType = (type: string) => type?.toUpperCase().trim() || '';
        
        return col.name !== original.name ||
               normalizeDataType(col.dataType) !== normalizeDataType(original.dataType) ||
               col.length !== original.length ||
               col.nullable !== original.nullable ||
               normalizeValue(col.defaultValue) !== normalizeValue(original.defaultValue) ||
               col.isPrimaryKey !== original.isPrimaryKey ||
               col.isUnique !== original.isUnique ||
               normalizeValue(col.comment) !== normalizeValue(original.comment);
    };

    const toggleDeleteColumn = (id: number) => {
        setColumns(columns.map(col => {
            if (col.id === id) {
                return { ...col, isDeleted: !col.isDeleted };
            }
            return col;
        }));
    };

    const removeColumn = (id: number) => {
        setColumns(columns.filter(col => col.id !== id));
    };

    const undoColumnChanges = (id: number) => {
        setColumns(columns.map(col => {
            if (col.id === id) {
                // Find the original column state
                const original = originalColumns.find(o => o.id === id);
                if (original) {
                    // Revert to the original state
                    return {
                        ...original,
                        id: col.id, // Keep the same ID
                        status: 'existing',
                        isDeleted: false
                    };
                }
            }
            return col;
        }));
    };

    const hasChanges = (): boolean => {
        // Check if table name changed
        if (tableName !== originalTableName) {
            return true;
        }
        
        // Check if any columns have changes
        return columns.some(col => {
            // New columns that aren't deleted
            if (col.status === 'new' && !col.isDeleted) {
                return true;
            }
            // Modified columns that aren't deleted
            if (col.status === 'modified' && !col.isDeleted) {
                return true;
            }
            // Deleted columns
            if (col.isDeleted) {
                return true;
            }
            return false;
        });
    };

    const handleApply = () => {
        setError('');
        setIsSubmitting(true);
        
        const changes = getChanges();
        
        vscode.postMessage({
            command: 'applyChanges',
            schema,
            tableName,
            originalTableName,
            owner,
            originalOwner,
            changes
        });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    const getStatusBadge = (status: string) => {
        const statusColors: Record<string, {bg: string, label: string}> = {
            new: { bg: 'rgba(0, 200, 100, 0.3)', label: 'NEW' },
            modified: { bg: 'rgba(255, 200, 0, 0.3)', label: 'MODIFIED' },
            deleted: { bg: 'rgba(255, 50, 50, 0.3)', label: 'DELETED' }
        };
        
        if (status === 'existing') {
            return null;
        }
        
        const statusInfo = statusColors[status];
        return (
            <span style={{
                display: 'inline-block',
                padding: '2px 6px',
                borderRadius: '3px',
                fontSize: '10px',
                fontWeight: 500,
                backgroundColor: statusInfo.bg,
                marginRight: spacing.xs
            }}>
                {statusInfo.label}
            </span>
        );
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

    return (
        <div style={{ ...layouts.container, maxWidth: '1200px', margin: '0 auto' }}>
            <h1 style={componentStyles.panelTitle}>
                Edit Table: {schema}.{originalTableName}
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
                    label="Schema"
                    value={schema}
                    onChange={(e) => setSchema(e.target.value)}
                    fullWidth={true}
                    style={{ maxWidth: '500px' }}
                    disabled
                />

                <Input
                    label="Table Name"
                    value={tableName}
                    onChange={(e) => setTableName(e.target.value)}
                    helperText="Renaming the table will be included in the ALTER TABLE statements"
                    fullWidth={true}
                    style={{ maxWidth: '500px' }}
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

            <Section title="Columns">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
                    <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
                        Modify existing columns or add new ones. Changes will be previewed below.
                    </div>
                    <Button 
                        variant="secondary" 
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        size="sm"
                        style={{ backgroundColor: 'transparent', border: 'none' }}
                    >
                        <span style={{ marginRight: '4px' }}>{showAdvanced ? '▼' : '▶'}</span>
                        {showAdvanced ? 'Hide' : 'Show'} Advanced Options
                    </Button>
                </div>
                <div style={{ 
                    overflowX: 'auto',
                    overflowY: 'auto',
                    maxHeight: 'calc(12 * 42px + 42px)',
                }}>
                    <table style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        marginTop: spacing.sm
                    }}>
                        <thead>
                            <tr style={{ backgroundColor: 'var(--vscode-editor-background)' }}>
                                <th style={headerCellStyle}>Status</th>
                                <th style={headerCellStyle}>Column Name</th>
                                <th style={headerCellStyle}>Data Type</th>
                                <th style={{...headerCellStyle, textAlign: 'center'}}>Nullable</th>
                                <th style={{...headerCellStyle, textAlign: 'center'}}>Unique</th>
                                <th style={{...headerCellStyle, textAlign: 'center'}}>Primary Key</th>
                                {showAdvanced && <th style={headerCellStyle}>Length</th>}
                                {showAdvanced && <th style={headerCellStyle}>Default</th>}
                                {showAdvanced && <th style={headerCellStyle}>Comment</th>}
                                <th style={headerCellStyle}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {columns.map((column) => {
                                const deletedCellStyle = column.isDeleted 
                                    ? { ...cellStyle, textDecoration: 'line-through' } 
                                    : cellStyle;
                                
                                return (
                                <tr 
                                    key={column.id} 
                                    style={{ 
                                        borderBottom: '1px solid var(--vscode-panel-border)',
                                        backgroundColor: column.isDeleted 
                                            ? 'rgba(255, 50, 50, 0.1)' 
                                            : column.status === 'new' 
                                            ? 'rgba(0, 200, 100, 0.1)' 
                                            : column.status === 'modified' 
                                            ? 'rgba(255, 200, 0, 0.1)' 
                                            : undefined,
                                        opacity: column.isDeleted ? 0.6 : 1
                                    }}
                                >
                                    <td style={deletedCellStyle}>
                                        {getStatusBadge(column.isDeleted ? 'deleted' : column.status)}
                                    </td>
                                    <td style={deletedCellStyle}>
                                        <Input
                                            value={column.name}
                                            onChange={(e) => updateColumn(column.id, 'name', e.target.value)}
                                            fullWidth={true}
                                            noWrapper={true}
                                            disabled={column.isDeleted}
                                            style={{ minWidth: '180px', maxWidth: '500px' }}
                                        />
                                    </td>
                                    <td style={deletedCellStyle}>
                                        <Select
                                            value={column.dataType}
                                            onChange={(e) => updateColumn(column.id, 'dataType', e.target.value)}
                                            options={getDataTypesForColumn(column, originalColumns).map(type => ({ value: type, label: type }))}
                                            fullWidth={true}
                                            noWrapper={true}
                                            disabled={column.isDeleted}
                                            style={{ minWidth: '180px', maxWidth: '500px' }}
                                        />
                                    </td>
                                    <td style={deletedCellStyle}>
                                        <div style={{ textAlign: 'center' }}>
                                            <input
                                                type="checkbox"
                                                checked={column.nullable}
                                                onChange={(e) => updateColumn(column.id, 'nullable', e.target.checked)}
                                                disabled={column.isPrimaryKey || column.isDeleted}
                                                style={{ cursor: (column.isPrimaryKey || column.isDeleted) ? 'not-allowed' : 'pointer' }}
                                            />
                                        </div>
                                    </td>
                                    <td style={deletedCellStyle}>
                                        <div style={{ textAlign: 'center' }}>
                                            <input
                                                type="checkbox"
                                                checked={column.isUnique}
                                                onChange={(e) => updateColumn(column.id, 'isUnique', e.target.checked)}
                                                disabled={column.isDeleted}
                                                style={{ cursor: column.isDeleted ? 'not-allowed' : 'pointer' }}
                                            />
                                        </div>
                                    </td>
                                    <td style={deletedCellStyle}>
                                        <div style={{ textAlign: 'center' }}>
                                            <input
                                                type="checkbox"
                                                checked={column.isPrimaryKey}
                                                onChange={(e) => updateColumn(column.id, 'isPrimaryKey', e.target.checked)}
                                                disabled={column.isDeleted}
                                                style={{ cursor: column.isDeleted ? 'not-allowed' : 'pointer' }}
                                            />
                                        </div>
                                    </td>
                                    {showAdvanced && (
                                        <td style={deletedCellStyle}>
                                            <Input
                                                type="number"
                                                value={column.length?.toString() || ''}
                                                onChange={(e) => updateColumn(column.id, 'length', e.target.value ? parseInt(e.target.value) : undefined)}
                                                placeholder={getLengthPlaceholder(column.dataType)}
                                                fullWidth={true}
                                                noWrapper={true}
                                                style={{ minWidth: '80px', maxWidth: '120px' }}
                                                disabled={!shouldShowLength(column.dataType) || column.isDeleted}
                                            />
                                        </td>
                                    )}
                                    {showAdvanced && (
                                        <td style={deletedCellStyle}>
                                            <Input
                                                value={column.defaultValue || ''}
                                                onChange={(e) => updateColumn(column.id, 'defaultValue', e.target.value)}
                                                fullWidth={true}
                                                noWrapper={true}
                                                disabled={column.isDeleted}
                                                style={{ minWidth: '80px', maxWidth: '120px' }}
                                            />
                                        </td>
                                    )}
                                    {showAdvanced && (
                                        <td style={deletedCellStyle}>
                                            <Input
                                                value={column.comment || ''}
                                                onChange={(e) => updateColumn(column.id, 'comment', e.target.value)}
                                                fullWidth={true}
                                                noWrapper={true}
                                                disabled={column.isDeleted}
                                                style={{ minWidth: '180px', maxWidth: '500px' }}
                                            />
                                        </td>
                                    )}
                                    <td style={{ ...cellStyle, opacity: 1 }}>
                                        <div style={{ display: 'flex', gap: spacing.xs }}>
                                            {column.status === 'existing' || column.status === 'modified' ? (
                                                <>
                                                    {column.status === 'modified' || column.isDeleted ? (
                                                        <Button
                                                            variant="secondary"
                                                            onClick={() => undoColumnChanges(column.id)}
                                                            size="sm"
                                                        >
                                                            Undo
                                                        </Button>
                                                    ) : (
                                                        <Button
                                                            variant="secondary"
                                                            onClick={() => toggleDeleteColumn(column.id)}
                                                            size="sm"
                                                        >
                                                            Delete
                                                        </Button>
                                                    )}
                                                </>
                                            ) : (
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => removeColumn(column.id)}
                                                    disabled={columns.length === 1}
                                                    size="sm"
                                                >
                                                    Remove
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                            })}
                        </tbody>
                    </table>
                </div>

                <div style={{ marginTop: spacing.md }}>
                    <Button 
                        variant="secondary" 
                        onClick={addNewColumn}
                        size="sm"
                    >
                        + Add Column
                    </Button>
                </div>
            </Section>

            <SqlPreview sql={sqlPreview} defaultOpen={showPreview} />

            <ActionButtons
                onSave={handleApply}
                onCancel={handleCancel}
                saveLabel="Apply Changes"
                saveDisabled={isSubmitting || !hasChanges()}
                loading={isSubmitting}
                loadingText="Applying..."
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

