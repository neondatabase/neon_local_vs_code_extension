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

interface CreateFunctionProps {
    schema: string;
}

interface FunctionParameter {
    id: number;
    mode: string;
    name: string;
    type: string;
    defaultValue: string;
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const RETURN_TYPES = [
    { value: '', label: '-- Select Return Type --' },
    // Common Types
    { value: 'VOID', label: 'VOID (No return value)' },
    { value: 'INTEGER', label: 'INTEGER' },
    { value: 'BIGINT', label: 'BIGINT' },
    { value: 'NUMERIC', label: 'NUMERIC' },
    { value: 'REAL', label: 'REAL' },
    { value: 'DOUBLE PRECISION', label: 'DOUBLE PRECISION' },
    { value: 'TEXT', label: 'TEXT' },
    { value: 'VARCHAR', label: 'VARCHAR' },
    { value: 'CHAR', label: 'CHAR' },
    { value: 'BOOLEAN', label: 'BOOLEAN' },
    { value: 'DATE', label: 'DATE' },
    { value: 'TIME', label: 'TIME' },
    { value: 'TIMESTAMP', label: 'TIMESTAMP' },
    { value: 'TIMESTAMPTZ', label: 'TIMESTAMPTZ' },
    { value: 'UUID', label: 'UUID' },
    { value: 'JSON', label: 'JSON' },
    { value: 'JSONB', label: 'JSONB' },
    // Array Types
    { value: 'INTEGER[]', label: 'INTEGER[]' },
    { value: 'TEXT[]', label: 'TEXT[]' },
    { value: 'JSONB[]', label: 'JSONB[]' },
    // Special
    { value: 'TRIGGER', label: 'TRIGGER (For trigger functions)' },
    { value: 'RECORD', label: 'RECORD' },
    { value: 'SETOF RECORD', label: 'SETOF RECORD' },
    { value: 'TABLE', label: 'TABLE' }
];

const LANGUAGES = [
    { value: 'plpgsql', label: 'PL/pgSQL (Procedural)' },
    { value: 'sql', label: 'SQL' }
];

const PARAMETER_MODES = [
    { value: 'IN', label: 'IN' },
    { value: 'OUT', label: 'OUT' },
    { value: 'INOUT', label: 'INOUT' }
];

const PARAMETER_TYPES = [
    { value: '', label: '-- Type --' },
    { value: 'INTEGER', label: 'INTEGER' },
    { value: 'BIGINT', label: 'BIGINT' },
    { value: 'NUMERIC', label: 'NUMERIC' },
    { value: 'REAL', label: 'REAL' },
    { value: 'DOUBLE PRECISION', label: 'DOUBLE PRECISION' },
    { value: 'TEXT', label: 'TEXT' },
    { value: 'VARCHAR', label: 'VARCHAR' },
    { value: 'CHAR', label: 'CHAR' },
    { value: 'BOOLEAN', label: 'BOOLEAN' },
    { value: 'DATE', label: 'DATE' },
    { value: 'TIME', label: 'TIME' },
    { value: 'TIMESTAMP', label: 'TIMESTAMP' },
    { value: 'TIMESTAMPTZ', label: 'TIMESTAMPTZ' },
    { value: 'UUID', label: 'UUID' },
    { value: 'JSON', label: 'JSON' },
    { value: 'JSONB', label: 'JSONB' },
    { value: 'INTEGER[]', label: 'INTEGER[]' },
    { value: 'TEXT[]', label: 'TEXT[]' },
    { value: 'JSONB[]', label: 'JSONB[]' }
];

export const CreateFunctionComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as CreateFunctionProps;

    const [schema] = useState(initialData.schema || '');
    
    const [functionName, setFunctionName] = useState('');
    const [returnType, setReturnType] = useState('');
    const [language, setLanguage] = useState('plpgsql');
    const [replaceIfExists, setReplaceIfExists] = useState(true);
    const [functionBody, setFunctionBody] = useState('');
    const [isVolatile, setIsVolatile] = useState(true);
    const [securityDefiner, setSecurityDefiner] = useState(false);
    
    const [parameters, setParameters] = useState<FunctionParameter[]>([]);
    const [paramIdCounter, setParamIdCounter] = useState(1);

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
        if (functionName && returnType && functionBody) {
            const funcDef = {
                schema,
                functionName,
                returnType,
                language,
                replaceIfExists,
                parameters,
                body: functionBody,
                isVolatile,
                securityDefiner
            };
            vscode.postMessage({ command: 'previewSql', funcDef });
        } else {
            setSqlPreview('');
        }
    }, [schema, functionName, returnType, language, replaceIfExists, parameters, functionBody, isVolatile, securityDefiner]);

    const addParameter = () => {
        const newParam: FunctionParameter = {
            id: paramIdCounter,
            mode: 'IN',
            name: '',
            type: '',
            defaultValue: ''
        };
        setParameters([...parameters, newParam]);
        setParamIdCounter(paramIdCounter + 1);
    };

    const removeParameter = (id: number) => {
        setParameters(parameters.filter(p => p.id !== id));
    };

    const updateParameter = (id: number, field: keyof FunctionParameter, value: string) => {
        // Validate parameter names
        if (field === 'name' && value.trim()) {
            // Check if parameter name starts with a number
            if (/^\d/.test(value)) {
                setError('Parameter names cannot start with a number. Use letters or underscores.');
                return;
            }
            // Check if parameter name contains only valid characters
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                setError('Parameter names can only contain letters, numbers, and underscores.');
                return;
            }
        }
        
        // Clear error if validation passes
        if (error && field === 'name') {
            setError('');
        }
        
        setParameters(parameters.map(p => 
            p.id === id ? { ...p, [field]: value } : p
        ));
    };

    const handleSubmit = () => {
        if (!functionName.trim()) {
            setError('Function name is required');
            return;
        }
        if (!returnType) {
            setError('Return type is required');
            return;
        }
        if (!functionBody.trim()) {
            setError('Function body is required');
            return;
        }
        
        // Validate all parameter names
        for (const param of parameters) {
            if (param.name.trim()) {
                if (/^\d/.test(param.name)) {
                    setError(`Parameter "${param.name}" cannot start with a number.`);
                    return;
                }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param.name)) {
                    setError(`Parameter "${param.name}" contains invalid characters. Use only letters, numbers, and underscores.`);
                    return;
                }
            }
            // Check that parameters with types have names
            if (param.type && !param.name.trim()) {
                setError('All parameters with a type must have a name.');
                return;
            }
        }

        setError('');
        setIsSubmitting(true);

        const funcDef = {
            schema,
            functionName,
            returnType,
            language,
            replaceIfExists,
            parameters,
            body: functionBody,
            isVolatile,
            securityDefiner
        };

        vscode.postMessage({ command: 'createFunction', funcDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '900px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create Function in {schema}
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

            <Section title="Basic Information">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Function Name"
                        value={functionName}
                        onChange={(e) => setFunctionName(e.target.value)}
                        placeholder="my_function"
                        helperText="Naming convention: lowercase with underscores"
                        required
                        style={{ maxWidth: '500px' }}
                    />

                    <Select
                        label="Return Type"
                        value={returnType}
                        onChange={(e) => setReturnType(e.target.value)}
                        options={RETURN_TYPES}
                        required
                        style={{ maxWidth: '500px' }}
                    />
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic',
                        marginTop: '-8px'
                    }}>
                        Use VOID for procedures, TRIGGER for trigger functions
                    </div>

                    <Select
                        label="Language"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        options={LANGUAGES}
                        style={{ maxWidth: '500px' }}
                    />
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic',
                        marginTop: '-8px'
                    }}>
                        PL/pgSQL is recommended for complex functions with variables and control structures. SQL is for simple functions.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                        <input
                            type="checkbox"
                            id="replaceIfExists"
                            checked={replaceIfExists}
                            onChange={(e) => setReplaceIfExists(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor="replaceIfExists" style={{ cursor: 'pointer', margin: 0 }}>
                            CREATE OR REPLACE
                        </label>
                    </div>
                </div>
            </Section>

            <Section title="Parameters">
                <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic', marginBottom: spacing.md }}>
                    Add input/output parameters for your function
                </div>
                
                {parameters.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic', marginBottom: spacing.md }}>
                        No parameters added yet
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, marginBottom: spacing.md }}>
                        {parameters.map(param => (
                            <div key={param.id} style={{
                                display: 'grid',
                                gridTemplateColumns: '80px 1fr 1fr 1fr 40px',
                                gap: spacing.sm,
                                alignItems: 'center'
                            }}>
                                <Select
                                    value={param.mode}
                                    onChange={(e) => updateParameter(param.id, 'mode', e.target.value)}
                                    options={PARAMETER_MODES}
                                    noWrapper
                                />

                                <Input
                                    type="text"
                                    value={param.name}
                                    onChange={(e) => updateParameter(param.id, 'name', e.target.value)}
                                    placeholder="param_name"
                                    noWrapper
                                />

                                <Select
                                    value={param.type}
                                    onChange={(e) => updateParameter(param.id, 'type', e.target.value)}
                                    options={PARAMETER_TYPES}
                                    noWrapper
                                />

                                <Input
                                    type="text"
                                    value={param.defaultValue}
                                    onChange={(e) => updateParameter(param.id, 'defaultValue', e.target.value)}
                                    placeholder="Default"
                                    noWrapper
                                />

                                <button
                                    onClick={() => removeParameter(param.id)}
                                    style={{
                                        backgroundColor: 'var(--vscode-errorForeground)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '3px',
                                        cursor: 'pointer',
                                        fontSize: '16px',
                                        height: '32px',
                                        width: '32px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                                    onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <button
                    onClick={addParameter}
                    style={{
                        padding: '8px 16px',
                        backgroundColor: 'var(--vscode-button-secondaryBackground)',
                        color: 'var(--vscode-button-secondaryForeground)',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '13px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryHoverBackground)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryBackground)'}
                >
                    + Add Parameter
                </button>
            </Section>

            <Section title="Function Body">
                <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic', marginBottom: spacing.sm }}>
                    Write your function code between BEGIN and END
                </div>

                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: 'var(--vscode-input-background)',
                    border: '1px solid var(--vscode-input-border)',
                    borderRadius: '3px',
                    fontFamily: "'Courier New', Courier, monospace",
                    fontSize: '13px'
                }}>
                    <div style={{
                        padding: '8px 12px',
                        color: 'var(--vscode-input-foreground)',
                        backgroundColor: 'var(--vscode-editor-inactiveSelectionBackground)',
                        opacity: 0.7,
                        userSelect: 'none'
                    }}>
                        BEGIN
                    </div>
                    <textarea
                        value={functionBody}
                        onChange={(e) => setFunctionBody(e.target.value)}
                        placeholder="    -- Your code here&#10;    RETURN result;"
                        rows={10}
                        style={{
                            width: '100%',
                            backgroundColor: 'var(--vscode-input-background)',
                            color: 'var(--vscode-input-foreground)',
                            border: 'none',
                            borderTop: '1px solid var(--vscode-input-border)',
                            borderBottom: '1px solid var(--vscode-input-border)',
                            padding: '8px 12px',
                            fontFamily: "'Courier New', Courier, monospace",
                            fontSize: '13px',
                            lineHeight: '1.5',
                            resize: 'vertical',
                            outline: 'none'
                        }}
                    />
                    <div style={{
                        padding: '8px 12px',
                        color: 'var(--vscode-input-foreground)',
                        backgroundColor: 'var(--vscode-editor-inactiveSelectionBackground)',
                        opacity: 0.7,
                        userSelect: 'none'
                    }}>
                        END;
                    </div>
                </div>

                <div style={{
                    marginTop: spacing.md,
                    padding: spacing.md,
                    backgroundColor: 'var(--vscode-textCodeBlock-background)',
                    borderRadius: '3px'
                }}>
                    <div style={{ fontWeight: 600, marginBottom: spacing.sm, fontSize: '12px' }}>
                        Common Patterns:
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.6' }}>
                        • Use RETURN to return a value<br />
                        • Declare variables: my_var INTEGER := 0;<br />
                        • Use $1, $2 to reference parameters
                    </div>
                </div>
            </Section>

            <CollapsibleSection title="Advanced Options" defaultExpanded={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: '4px' }}>
                            <input
                                type="checkbox"
                                id="isVolatile"
                                checked={isVolatile}
                                onChange={(e) => setIsVolatile(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <label htmlFor="isVolatile" style={{ cursor: 'pointer', margin: 0 }}>
                                VOLATILE
                            </label>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' }}>
                            Uncheck for STABLE functions (deterministic, no database modifications)
                        </div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: '4px' }}>
                            <input
                                type="checkbox"
                                id="securityDefiner"
                                checked={securityDefiner}
                                onChange={(e) => setSecurityDefiner(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <label htmlFor="securityDefiner" style={{ cursor: 'pointer', margin: 0 }}>
                                SECURITY DEFINER
                            </label>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' }}>
                            Execute with privileges of function owner (use with caution)
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
                saveLabel="Create Function"
                loading={isSubmitting}
            />
        </div>
    );
};

interface EditFunctionProps {
    schema: string;
    functionName: string;
    definition: string;
    arguments: string;
    returnType: string;
    language: string;
    volatility: string;
    securityDefiner: boolean;
}

