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

interface ConstraintDefinition {
    constraintName: string;
    tableName: string;
    schema: string;
    constraintType: 'check' | 'unique' | 'exclusion' | 'foreignkey';
    columns?: string[];
    checkExpression?: string;
    exclusionMethod?: string;
    exclusionElements?: Array<{element: string; operator: string}>;
    foreignKeyReferencedTable?: string;
    foreignKeyReferencedSchema?: string;
    foreignKeyReferencedColumns?: string[];
    foreignKeyOnUpdate?: string;
    foreignKeyOnDelete?: string;
    foreignKeyMatch?: string;
    deferrable?: boolean;
    deferred?: boolean;
}

interface ConstraintManagementProps {
    schema: string;
    tableName: string;
    columns: string[];
    mode: 'create' | 'edit';
    currentConstraint?: any;
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const CONSTRAINT_TYPES = [
    { value: 'check', label: 'CHECK - Validate expression' },
    { value: 'unique', label: 'UNIQUE - Ensure column uniqueness' },
    { value: 'exclusion', label: 'EXCLUSION - Prevent overlapping values' },
    { value: 'foreignkey', label: 'FOREIGN KEY - Reference another table' }
];

const FK_ACTIONS = [
    { value: 'NO ACTION', label: 'NO ACTION (Default)' },
    { value: 'RESTRICT', label: 'RESTRICT' },
    { value: 'CASCADE', label: 'CASCADE' },
    { value: 'SET NULL', label: 'SET NULL' },
    { value: 'SET DEFAULT', label: 'SET DEFAULT' }
];

const FK_MATCH_TYPES = [
    { value: 'SIMPLE', label: 'SIMPLE (Default)' },
    { value: 'FULL', label: 'FULL' },
    { value: 'PARTIAL', label: 'PARTIAL' }
];

const EXCLUSION_METHODS = [
    { value: 'btree', label: 'B-tree' },
    { value: 'hash', label: 'Hash' }
];

export const CreateConstraintComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ConstraintManagementProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const availableColumns = initialData.columns || [];
    
    const [constraintName, setConstraintName] = useState('');
    const [constraintType, setConstraintType] = useState<'check' | 'unique' | 'exclusion' | 'foreignkey'>('check');
    
    // CHECK fields
    const [checkExpression, setCheckExpression] = useState('');
    
    // UNIQUE fields
    const [uniqueColumns, setUniqueColumns] = useState<string[]>([]);
    
    // EXCLUSION fields
    const [exclusionMethod, setExclusionMethod] = useState('btree');
    const [exclusionElements, setExclusionElements] = useState<Array<{element: string; operator: string}>>([{element: '', operator: '='}]);
    
    // FOREIGN KEY fields
    const [fkColumns, setFkColumns] = useState<string[]>([]);
    const [fkReferencedSchema, setFkReferencedSchema] = useState(schema);
    const [fkReferencedTable, setFkReferencedTable] = useState('');
    const [fkReferencedColumns, setFkReferencedColumns] = useState('');
    const [fkOnUpdate, setFkOnUpdate] = useState('NO ACTION');
    const [fkOnDelete, setFkOnDelete] = useState('NO ACTION');
    const [fkMatch, setFkMatch] = useState('SIMPLE');
    
    // Advanced options
    const [deferrable, setDeferrable] = useState(false);
    const [deferred, setDeferred] = useState(false);

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
        if (constraintName) {
            const constraintDef: ConstraintDefinition = {
                constraintName,
                tableName,
                schema,
                constraintType,
                checkExpression: constraintType === 'check' ? checkExpression : undefined,
                columns: constraintType === 'unique' ? uniqueColumns : (constraintType === 'foreignkey' ? fkColumns : undefined),
                exclusionMethod: constraintType === 'exclusion' ? exclusionMethod : undefined,
                exclusionElements: constraintType === 'exclusion' ? exclusionElements : undefined,
                foreignKeyReferencedSchema: constraintType === 'foreignkey' ? fkReferencedSchema : undefined,
                foreignKeyReferencedTable: constraintType === 'foreignkey' ? fkReferencedTable : undefined,
                foreignKeyReferencedColumns: constraintType === 'foreignkey' ? fkReferencedColumns.split(',').map(c => c.trim()).filter(c => c) : undefined,
                foreignKeyOnUpdate: constraintType === 'foreignkey' ? fkOnUpdate : undefined,
                foreignKeyOnDelete: constraintType === 'foreignkey' ? fkOnDelete : undefined,
                foreignKeyMatch: constraintType === 'foreignkey' ? fkMatch : undefined,
                deferrable,
                deferred
            };
            vscode.postMessage({ command: 'previewSql', constraintDef });
        } else {
            setSqlPreview('');
        }
    }, [constraintName, constraintType, checkExpression, uniqueColumns, fkColumns, exclusionMethod, exclusionElements, 
        fkReferencedSchema, fkReferencedTable, fkReferencedColumns, fkOnUpdate, fkOnDelete, fkMatch, deferrable, deferred, tableName, schema]);

    const handleColumnToggle = (columnName: string, type: 'unique' | 'foreignkey') => {
        if (type === 'unique') {
            setUniqueColumns(prev => 
                prev.includes(columnName) ? prev.filter(c => c !== columnName) : [...prev, columnName]
            );
        } else {
            setFkColumns(prev => 
                prev.includes(columnName) ? prev.filter(c => c !== columnName) : [...prev, columnName]
            );
        }
    };

    const handleAddExclusionElement = () => {
        setExclusionElements([...exclusionElements, {element: '', operator: '='}]);
    };

    const handleRemoveExclusionElement = (index: number) => {
        setExclusionElements(exclusionElements.filter((_, i) => i !== index));
    };

    const handleExclusionElementChange = (index: number, field: 'element' | 'operator', value: string) => {
        const newElements = [...exclusionElements];
        newElements[index][field] = value;
        setExclusionElements(newElements);
    };

    const handleSubmit = () => {
        if (!constraintName.trim()) {
            setError('Constraint name is required');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const constraintDef: ConstraintDefinition = {
            constraintName,
            tableName,
            schema,
            constraintType,
            checkExpression: constraintType === 'check' ? checkExpression : undefined,
            columns: constraintType === 'unique' ? uniqueColumns : (constraintType === 'foreignkey' ? fkColumns : undefined),
            exclusionMethod: constraintType === 'exclusion' ? exclusionMethod : undefined,
            exclusionElements: constraintType === 'exclusion' ? exclusionElements : undefined,
            foreignKeyReferencedSchema: constraintType === 'foreignkey' ? fkReferencedSchema : undefined,
            foreignKeyReferencedTable: constraintType === 'foreignkey' ? fkReferencedTable : undefined,
            foreignKeyReferencedColumns: constraintType === 'foreignkey' ? fkReferencedColumns.split(',').map(c => c.trim()).filter(c => c) : undefined,
            foreignKeyOnUpdate: constraintType === 'foreignkey' ? fkOnUpdate : undefined,
            foreignKeyOnDelete: constraintType === 'foreignkey' ? fkOnDelete : undefined,
            foreignKeyMatch: constraintType === 'foreignkey' ? fkMatch : undefined,
            deferrable,
            deferred
        };

        vscode.postMessage({ command: 'createConstraint', constraintDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create Constraint on {schema}.{tableName}
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

            <Section title="Constraint Details">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Constraint Name"
                        value={constraintName}
                        onChange={(e) => setConstraintName(e.target.value)}
                        helperText="Naming conventions: chk_ for CHECK, uq_ for UNIQUE, ex_ for EXCLUSION, fk_ for FOREIGN KEY"
                        required
                    />

                    <Select
                        label="Constraint Type"
                        value={constraintType}
                        onChange={(e) => setConstraintType(e.target.value as any)}
                        options={CONSTRAINT_TYPES}
                        required
                        helperText="CHECK validates data, UNIQUE prevents duplicates, EXCLUSION prevents overlaps, FOREIGN KEY enforces relationships"
                    />
                </div>
            </Section>

            {constraintType === 'check' && (
                <Section title="CHECK Expression">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                                Expression <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                            </label>
                            <textarea
                                value={checkExpression}
                                onChange={(e) => setCheckExpression(e.target.value)}
                                placeholder="e.g., age >= 18 AND age <= 120"
                                rows={4}
                                style={{
                                    width: '100%',
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
                                Boolean expression that must evaluate to true for all rows
                            </div>
                        </div>
                    </div>
                </Section>
            )}

            {constraintType === 'unique' && (
                <Section title="Select Columns">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic'
                        }}>
                            Select one or more columns that must be unique together
                        </div>

                        <div style={{
                            border: '1px solid var(--vscode-input-border)',
                            borderRadius: '3px',
                            padding: spacing.sm,
                            maxHeight: '150px',
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
                                    onClick={() => handleColumnToggle(col, 'unique')}
                                >
                                    <input
                                        type="checkbox"
                                        checked={uniqueColumns.includes(col)}
                                        onChange={() => handleColumnToggle(col, 'unique')}
                                        style={{ cursor: 'pointer' }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <label style={{ cursor: 'pointer', margin: 0 }}>{col}</label>
                                </div>
                            ))}
                        </div>
                    </div>
                </Section>
            )}

            {constraintType === 'exclusion' && (
                <Section title="Exclusion Configuration">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <Select
                            label="Index Method"
                            value={exclusionMethod}
                            onChange={(e) => setExclusionMethod(e.target.value)}
                            options={EXCLUSION_METHODS}
                            required
                            helperText="B-tree is the default index method for exclusion constraints"
                        />

                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: '500' }}>
                                Exclusion Elements
                            </label>
                            {exclusionElements.map((elem, index) => (
                                <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 40px', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center' }}>
                                    <Input
                                        value={elem.element}
                                        onChange={(e) => handleExclusionElementChange(index, 'element', e.target.value)}
                                        placeholder="column_name"
                                        noWrapper
                                    />
                                    <Input
                                        value={elem.operator}
                                        onChange={(e) => handleExclusionElementChange(index, 'operator', e.target.value)}
                                        placeholder="="
                                        noWrapper
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveExclusionElement(index)}
                                        style={{
                                            backgroundColor: 'var(--vscode-button-secondaryBackground)',
                                            color: 'var(--vscode-button-secondaryForeground)',
                                            border: 'none',
                                            padding: '8px',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '16px',
                                            height: '100%',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryHoverBackground)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                onClick={handleAddExclusionElement}
                                style={{
                                    backgroundColor: 'var(--vscode-button-secondaryBackground)',
                                    color: 'var(--vscode-button-secondaryForeground)',
                                    border: 'none',
                                    padding: '8px 16px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    marginTop: spacing.sm
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryHoverBackground)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
                                }}
                            >
                                Add Element
                            </button>
                        </div>
                    </div>
                </Section>
            )}

            {constraintType === 'foreignkey' && (
                <Section title="Foreign Key Configuration">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: '500' }}>
                                Local Columns <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                            </label>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginBottom: spacing.sm
                            }}>
                                Select columns from this table that reference another table
                            </div>
                            <div style={{
                                border: '1px solid var(--vscode-input-border)',
                                borderRadius: '3px',
                                padding: spacing.sm,
                                maxHeight: '150px',
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
                                        onClick={() => handleColumnToggle(col, 'foreignkey')}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={fkColumns.includes(col)}
                                            onChange={() => handleColumnToggle(col, 'foreignkey')}
                                            style={{ cursor: 'pointer' }}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <label style={{ cursor: 'pointer', margin: 0 }}>{col}</label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Input
                            label="Referenced Schema"
                            value={fkReferencedSchema}
                            onChange={(e) => setFkReferencedSchema(e.target.value)}
                            helperText="Schema containing the referenced table"
                            required
                        />

                        <Input
                            label="Referenced Table"
                            value={fkReferencedTable}
                            onChange={(e) => setFkReferencedTable(e.target.value)}
                            placeholder="referenced_table"
                            helperText="Table that is being referenced"
                            required
                        />

                        <Input
                            label="Referenced Columns"
                            value={fkReferencedColumns}
                            onChange={(e) => setFkReferencedColumns(e.target.value)}
                            placeholder="id, code"
                            helperText="Comma-separated list of columns in the referenced table"
                            required
                        />

                        <Select
                            label="ON DELETE"
                            value={fkOnDelete}
                            onChange={(e) => setFkOnDelete(e.target.value)}
                            options={FK_ACTIONS}
                            helperText="Action to take when referenced row is deleted"
                        />

                        <Select
                            label="ON UPDATE"
                            value={fkOnUpdate}
                            onChange={(e) => setFkOnUpdate(e.target.value)}
                            options={FK_ACTIONS}
                            helperText="Action to take when referenced row is updated"
                        />

                        <Select
                            label="MATCH Type"
                            value={fkMatch}
                            onChange={(e) => setFkMatch(e.target.value)}
                            options={FK_MATCH_TYPES}
                            helperText="How NULL values in the foreign key are handled"
                        />
                    </div>
                </Section>
            )}

            <CollapsibleSection title="Advanced Options" defaultOpen={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={deferrable}
                                onChange={(e) => setDeferrable(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Deferrable</span>
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginLeft: '24px'
                        }}>
                            Allows constraint checking to be deferred until end of transaction
                        </div>
                    </div>

                    {deferrable && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={deferred}
                                    onChange={(e) => setDeferred(e.target.checked)}
                                    style={{ cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: '13px', fontWeight: '500' }}>Initially Deferred</span>
                            </label>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginLeft: '24px'
                            }}>
                                Constraint is deferred by default (can be changed with SET CONSTRAINTS)
                            </div>
                        </div>
                    )}
                </div>
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Create Constraint"
                loading={isSubmitting}
            />
        </div>
    );
};

export const EditConstraintComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ConstraintManagementProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const availableColumns = initialData.columns || [];
    const constraintInfo = initialData.currentConstraint || {};
    
    // Parse constraint type from PostgreSQL constraint type
    const parseConstraintType = (pgType: string): 'check' | 'unique' | 'exclusion' | 'foreignkey' => {
        if (pgType === 'c') return 'check';
        if (pgType === 'u') return 'unique';
        if (pgType === 'x') return 'exclusion';
        if (pgType === 'f') return 'foreignkey';
        return 'check';
    };

    // Parse initial values from constraint definition
    const parseConstraintData = () => {
        const type = parseConstraintType(constraintInfo.constraint_type);
        const definition = constraintInfo.definition || '';
        
        if (type === 'check') {
            const checkMatch = definition.match(/CHECK\s*\((.*)\)/is);
            return {
                type,
                checkExpression: checkMatch ? checkMatch[1].trim() : ''
            };
        } else if (type === 'unique') {
            const uniqueMatch = definition.match(/UNIQUE\s*\((.*?)\)/i);
            const cols = uniqueMatch ? uniqueMatch[1].split(',').map((c: string) => c.trim().replace(/"/g, '')) : [];
            return {
                type,
                columns: cols
            };
        }
        
        return { type, checkExpression: '', columns: [] };
    };

    const parsed = parseConstraintData();
    
    const [constraintName, setConstraintName] = useState(constraintInfo.name || '');
    const [constraintType] = useState<'check' | 'unique' | 'exclusion' | 'foreignkey'>(parsed.type);
    
    // CHECK fields
    const [checkExpression, setCheckExpression] = useState(parsed.checkExpression || '');
    
    // UNIQUE fields
    const [uniqueColumns, setUniqueColumns] = useState<string[]>(parsed.columns || []);
    
    // Advanced options
    const [deferrable, setDeferrable] = useState(constraintInfo.is_deferrable || false);
    const [deferred, setDeferred] = useState(constraintInfo.is_deferred || false);

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
        if (constraintName) {
            const constraintDef: ConstraintDefinition = {
                constraintName,
                tableName,
                schema,
                constraintType,
                checkExpression: constraintType === 'check' ? checkExpression : undefined,
                columns: constraintType === 'unique' ? uniqueColumns : undefined,
                deferrable,
                deferred
            };
            vscode.postMessage({ command: 'previewSql', constraintDef });
        } else {
            setSqlPreview('');
        }
    }, [constraintName, constraintType, checkExpression, uniqueColumns, deferrable, deferred, tableName, schema]);

    const handleColumnToggle = (columnName: string) => {
        setUniqueColumns(prev => 
            prev.includes(columnName) ? prev.filter(c => c !== columnName) : [...prev, columnName]
        );
    };

    const handleSubmit = () => {
        if (!constraintName.trim()) {
            setError('Constraint name is required');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const constraintDef: ConstraintDefinition = {
            constraintName,
            tableName,
            schema,
            constraintType,
            checkExpression: constraintType === 'check' ? checkExpression : undefined,
            columns: constraintType === 'unique' ? uniqueColumns : undefined,
            deferrable,
            deferred
        };

        vscode.postMessage({ command: 'editConstraint', constraintDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Edit Constraint: {constraintInfo.name}
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

            <Section title="Constraint Details">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Constraint Name"
                        value={constraintName}
                        onChange={(e) => setConstraintName(e.target.value)}
                        helperText="Rename the constraint by changing the name"
                        required
                    />

                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                            Constraint Type
                        </label>
                        <Input
                            value={constraintType.toUpperCase()}
                            readOnly
                        />
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginTop: '4px'
                        }}>
                            Constraint type cannot be changed
                        </div>
                    </div>
                </div>
            </Section>

            {constraintType === 'check' && (
                <Section title="CHECK Expression">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                                Expression <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                            </label>
                            <textarea
                                value={checkExpression}
                                onChange={(e) => setCheckExpression(e.target.value)}
                                placeholder="e.g., age >= 18 AND age <= 120"
                                rows={4}
                                style={{
                                    width: '100%',
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
                                Boolean expression that must evaluate to true for all rows
                            </div>
                        </div>
                    </div>
                </Section>
            )}

            {constraintType === 'unique' && (
                <Section title="Select Columns">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic'
                        }}>
                            Select one or more columns that must be unique together
                        </div>

                        <div style={{
                            border: '1px solid var(--vscode-input-border)',
                            borderRadius: '3px',
                            padding: spacing.sm,
                            maxHeight: '150px',
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
                                        checked={uniqueColumns.includes(col)}
                                        onChange={() => handleColumnToggle(col)}
                                        style={{ cursor: 'pointer' }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <label style={{ cursor: 'pointer', margin: 0 }}>{col}</label>
                                </div>
                            ))}
                        </div>
                    </div>
                </Section>
            )}

            {(constraintType === 'exclusion' || constraintType === 'foreignkey') && (
                <div style={{
                    padding: spacing.lg,
                    backgroundColor: 'var(--vscode-inputValidation-infoBackground)',
                    border: '1px solid var(--vscode-inputValidation-infoBorder)',
                    borderRadius: '4px',
                    marginTop: spacing.md
                }}>
                    <div style={{ fontSize: '13px', color: 'var(--vscode-inputValidation-infoForeground)' }}>
                        Editing {constraintType.toUpperCase()} constraints is not supported. Please drop and recreate the constraint to make changes.
                    </div>
                </div>
            )}

            <CollapsibleSection title="Advanced Options" defaultOpen={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={deferrable}
                                onChange={(e) => setDeferrable(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Deferrable</span>
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginLeft: '24px'
                        }}>
                            Allows constraint checking to be deferred until end of transaction
                        </div>
                    </div>

                    {deferrable && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={deferred}
                                    onChange={(e) => setDeferred(e.target.checked)}
                                    style={{ cursor: 'pointer' }}
                                />
                                <span style={{ fontSize: '13px', fontWeight: '500' }}>Initially Deferred</span>
                            </label>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginLeft: '24px'
                            }}>
                                Constraint is deferred by default (can be changed with SET CONSTRAINTS)
                            </div>
                        </div>
                    )}
                </div>
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Update Constraint"
                loading={isSubmitting}
            />
        </div>
    );
};
