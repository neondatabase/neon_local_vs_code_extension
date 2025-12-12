import React, { useState, useEffect } from 'react';
import {
    Input,
    Select,
    Section,
    ActionButtons,
    SqlPreview,
    CollapsibleSection,
    useScrollToError
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

interface ColumnDefinition {
    name: string;
    dataType: string;
    length?: number;
    precision?: number;
    scale?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey?: boolean;
    isUnique?: boolean;
}

interface ColumnManagementProps {
    schema: string;
    tableName: string;
    columnName?: string;
    currentColumn?: any;
    mode: 'create' | 'edit';
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const DATA_TYPES = [
    { label: 'Numeric Types', options: ['INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL', 'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION'] },
    { label: 'Text Types', options: ['VARCHAR', 'CHAR', 'TEXT'] },
    { label: 'Date/Time Types', options: ['DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ'] },
    { label: 'Other Types', options: ['BOOLEAN', 'UUID', 'JSON', 'JSONB', 'BYTEA'] }
];

const needsLength = (dataType: string) => {
    const dt = dataType.toUpperCase();
    return dt === 'VARCHAR' || dt === 'CHAR';
};

const needsPrecision = (dataType: string) => {
    const dt = dataType.toUpperCase();
    return dt === 'NUMERIC' || dt === 'DECIMAL';
};

export const CreateColumnComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ColumnManagementProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    
    const [columnName, setColumnName] = useState('');
    const [dataType, setDataType] = useState('INTEGER');
    const [length, setLength] = useState<number | undefined>(undefined);
    const [precision, setPrecision] = useState<number | undefined>(undefined);
    const [scale, setScale] = useState<number | undefined>(undefined);
    const [nullable, setNullable] = useState(true);
    const [defaultValue, setDefaultValue] = useState('');
    const [isPrimaryKey, setIsPrimaryKey] = useState(false);
    const [isUnique, setIsUnique] = useState(false);

    const [error, setError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

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
        if (columnName && dataType) {
            const columnDef: ColumnDefinition = {
                name: columnName,
                dataType,
                length: needsLength(dataType) ? length : undefined,
                precision: needsPrecision(dataType) ? precision : undefined,
                scale: needsPrecision(dataType) ? scale : undefined,
                nullable,
                defaultValue: defaultValue || undefined,
                isPrimaryKey,
                isUnique
            };
            vscode.postMessage({ command: 'previewSql', columnDef });
        } else {
            setSqlPreview('');
        }
    }, [columnName, dataType, length, precision, scale, nullable, defaultValue, isPrimaryKey, isUnique]);

    const handleSubmit = () => {
        if (!columnName.trim()) {
            setError('Column name is required');
            return;
        }

        if (!dataType) {
            setError('Data type is required');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const columnDef: ColumnDefinition = {
            name: columnName,
            dataType,
            length: needsLength(dataType) ? length : undefined,
            precision: needsPrecision(dataType) ? precision : undefined,
            scale: needsPrecision(dataType) ? scale : undefined,
            nullable,
            defaultValue: defaultValue || undefined,
            isPrimaryKey,
            isUnique
        };

        vscode.postMessage({ command: 'createColumn', columnDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    // Flatten data types for select
    const flatDataTypes = DATA_TYPES.flatMap(group => 
        group.options.map(opt => ({ value: opt, label: opt }))
    );

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Add Column to {schema}.{tableName}
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

            <Section title="Column Details">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Column Name"
                        value={columnName}
                        onChange={(e) => setColumnName(e.target.value)}
                        helperText="Must start with a letter and contain only letters, numbers, and underscores"
                        required
                    />

                    <Select
                        label="Data Type"
                        value={dataType}
                        onChange={(e) => setDataType(e.target.value)}
                        options={flatDataTypes}
                        required
                    />

                    {needsLength(dataType) && (
                        <Input
                            label="Length"
                            type="number"
                            value={length?.toString() || ''}
                            onChange={(e) => setLength(e.target.value ? parseInt(e.target.value) : undefined)}
                            placeholder="255"
                            helperText="Character length for VARCHAR/CHAR types"
                        />
                    )}

                    {needsPrecision(dataType) && (
                        <>
                            <Input
                                label="Precision"
                                type="number"
                                value={precision?.toString() || ''}
                                onChange={(e) => setPrecision(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder="10"
                                helperText="Total number of digits"
                            />
                            <Input
                                label="Scale"
                                type="number"
                                value={scale?.toString() || ''}
                                onChange={(e) => setScale(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder="2"
                                helperText="Number of digits after decimal point"
                            />
                        </>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={nullable}
                                onChange={(e) => setNullable(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Allow NULL</span>
                        </label>
                    </div>

                    <Input
                        label="Default Value"
                        value={defaultValue}
                        onChange={(e) => setDefaultValue(e.target.value)}
                        placeholder="NULL, 0, 'text', NOW()"
                        helperText="Default value expression"
                    />
                </div>
            </Section>

            <CollapsibleSection title="Constraints" defaultOpen={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={isPrimaryKey}
                                onChange={(e) => setIsPrimaryKey(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Primary Key</span>
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginLeft: '24px'
                        }}>
                            Make this column the primary key
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={isUnique}
                                onChange={(e) => setIsUnique(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Unique</span>
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginLeft: '24px'
                        }}>
                            Ensure all values in this column are unique
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Add Column"
                loading={isSubmitting}
            />
        </div>
    );
};

export const EditColumnComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ColumnManagementProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const [originalColumnName] = useState(initialData.columnName || '');
    
    const currentColumn = initialData.currentColumn || {};
    
    // Normalize SERIAL types to INTEGER/BIGINT since SERIAL is a pseudo-type
    const normalizeDataType = (dt: string) => {
        const upper = (dt || 'INTEGER').toUpperCase();
        if (upper === 'SERIAL') return 'INTEGER';
        if (upper === 'BIGSERIAL') return 'BIGINT';
        return upper;
    };
    
    // Store original values for change detection
    const [originalColumnName_] = useState(currentColumn.column_name || '');
    const [originalDataType] = useState(normalizeDataType(currentColumn.data_type));
    const [originalLength] = useState<number | undefined>(currentColumn.character_maximum_length || undefined);
    const [originalPrecision] = useState<number | undefined>(currentColumn.numeric_precision || undefined);
    const [originalScale] = useState<number | undefined>(currentColumn.numeric_scale || undefined);
    const [originalNullable] = useState(currentColumn.is_nullable === 'YES');
    const [originalDefaultValue] = useState(currentColumn.column_default || '');
    const [originalIsPrimaryKey] = useState(currentColumn.is_primary_key || false);
    const [originalIsUnique] = useState(currentColumn.is_unique || false);
    
    const [columnName, setColumnName] = useState(currentColumn.column_name || '');
    const [dataType, setDataType] = useState(normalizeDataType(currentColumn.data_type));
    const [length, setLength] = useState<number | undefined>(currentColumn.character_maximum_length || undefined);
    const [precision, setPrecision] = useState<number | undefined>(currentColumn.numeric_precision || undefined);
    const [scale, setScale] = useState<number | undefined>(currentColumn.numeric_scale || undefined);
    const [nullable, setNullable] = useState(currentColumn.is_nullable === 'YES');
    const [defaultValue, setDefaultValue] = useState(currentColumn.column_default || '');
    const [isPrimaryKey, setIsPrimaryKey] = useState(currentColumn.is_primary_key || false);
    const [isUnique, setIsUnique] = useState(currentColumn.is_unique || false);

    const [error, setError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    // Check if any changes have been made
    const hasChanges = (): boolean => {
        if (columnName !== originalColumnName_) return true;
        if (dataType !== originalDataType) return true;
        if (length !== originalLength) return true;
        if (precision !== originalPrecision) return true;
        if (scale !== originalScale) return true;
        if (nullable !== originalNullable) return true;
        if (defaultValue !== originalDefaultValue) return true;
        if (isPrimaryKey !== originalIsPrimaryKey) return true;
        if (isUnique !== originalIsUnique) return true;
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
        
        if (columnName && dataType) {
            const columnDef: ColumnDefinition = {
                name: columnName,
                dataType,
                length: needsLength(dataType) ? length : undefined,
                precision: needsPrecision(dataType) ? precision : undefined,
                scale: needsPrecision(dataType) ? scale : undefined,
                nullable,
                defaultValue: defaultValue || undefined,
                isPrimaryKey,
                isUnique
            };
            vscode.postMessage({ command: 'previewSql', columnDef });
        } else {
            setSqlPreview('');
        }
    }, [columnName, dataType, length, precision, scale, nullable, defaultValue, isPrimaryKey, isUnique]);

    const handleSubmit = () => {
        if (!columnName.trim()) {
            setError('Column name is required');
            return;
        }

        if (!dataType) {
            setError('Data type is required');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const columnDef: ColumnDefinition = {
            name: columnName,
            dataType,
            length: needsLength(dataType) ? length : undefined,
            precision: needsPrecision(dataType) ? precision : undefined,
            scale: needsPrecision(dataType) ? scale : undefined,
            nullable,
            defaultValue: defaultValue || undefined,
            isPrimaryKey,
            isUnique
        };

        vscode.postMessage({ command: 'editColumn', columnDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    // Flatten data types for select, excluding SERIAL types (pseudo-types that can't be used in ALTER COLUMN)
    const flatDataTypes = DATA_TYPES.flatMap(group => 
        group.options
            .filter(opt => opt !== 'SERIAL' && opt !== 'BIGSERIAL')
            .map(opt => ({ value: opt, label: opt }))
    );

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Edit Column: {schema}.{tableName}.{originalColumnName}
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

            <Section title="Column Details">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Column Name"
                        value={columnName}
                        onChange={(e) => setColumnName(e.target.value)}
                        helperText="Renaming the column will be included in the ALTER TABLE statements"
                        required
                    />

                    <Select
                        label="Data Type"
                        value={dataType}
                        onChange={(e) => setDataType(e.target.value)}
                        options={flatDataTypes}
                        required
                    />

                    {needsLength(dataType) && (
                        <Input
                            label="Length"
                            type="number"
                            value={length?.toString() || ''}
                            onChange={(e) => setLength(e.target.value ? parseInt(e.target.value) : undefined)}
                            placeholder="255"
                            helperText="Character length for VARCHAR/CHAR types"
                        />
                    )}

                    {needsPrecision(dataType) && (
                        <>
                            <Input
                                label="Precision"
                                type="number"
                                value={precision?.toString() || ''}
                                onChange={(e) => setPrecision(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder="10"
                                helperText="Total number of digits"
                            />
                            <Input
                                label="Scale"
                                type="number"
                                value={scale?.toString() || ''}
                                onChange={(e) => setScale(e.target.value ? parseInt(e.target.value) : undefined)}
                                placeholder="2"
                                helperText="Number of digits after decimal point"
                            />
                        </>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={nullable}
                                onChange={(e) => setNullable(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Allow NULL</span>
                        </label>
                    </div>

                    <Input
                        label="Default Value"
                        value={defaultValue}
                        onChange={(e) => setDefaultValue(e.target.value)}
                        placeholder="NULL, 0, 'text', NOW()"
                        helperText="Default value expression"
                    />
                </div>
            </Section>

            <CollapsibleSection title="Constraints" defaultOpen={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={isPrimaryKey}
                                onChange={(e) => setIsPrimaryKey(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Primary Key</span>
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginLeft: '24px'
                        }}>
                            Make this column the primary key
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={isUnique}
                                onChange={(e) => setIsUnique(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Unique</span>
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginLeft: '24px'
                        }}>
                            Ensure all values in this column are unique
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Update Column"
                loading={isSubmitting}
                saveDisabled={isSubmitting || !hasChanges()}
            />
        </div>
    );
};

