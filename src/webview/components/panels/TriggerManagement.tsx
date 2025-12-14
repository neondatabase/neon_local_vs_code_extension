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

interface TriggerFunction {
    function_name: string;
    schema_name: string;
    arguments?: string;
}

interface TriggerColumn {
    column_name: string;
    data_type: string;
}

interface CreateTriggerProps {
    schema: string;
    tableName: string;
    functions: TriggerFunction[];
    columns: TriggerColumn[];
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const TIMING_OPTIONS = [
    { value: 'BEFORE', label: 'BEFORE - Execute before the event' },
    { value: 'AFTER', label: 'AFTER - Execute after the event' },
    { value: 'INSTEAD OF', label: 'INSTEAD OF - Replace the event (views only)' }
];

const LEVEL_OPTIONS = [
    { value: 'ROW', label: 'FOR EACH ROW - Execute once per affected row' },
    { value: 'STATEMENT', label: 'FOR EACH STATEMENT - Execute once per statement' }
];

export const CreateTriggerComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as CreateTriggerProps;

    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const availableFunctions = initialData.functions || [];
    const availableColumns = initialData.columns || [];
    
    const [triggerName, setTriggerName] = useState('');
    const [timing, setTiming] = useState('BEFORE');
    const [eventInsert, setEventInsert] = useState(false);
    const [eventUpdate, setEventUpdate] = useState(false);
    const [eventDelete, setEventDelete] = useState(false);
    const [eventTruncate, setEventTruncate] = useState(false);
    const [level, setLevel] = useState('ROW');
    const [triggerFunction, setTriggerFunction] = useState('');
    const [functionArgs, setFunctionArgs] = useState('');
    const [whenCondition, setWhenCondition] = useState('');

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
        if (triggerName && triggerFunction && (eventInsert || eventUpdate || eventDelete || eventTruncate)) {
            const events = [];
            if (eventInsert) events.push('INSERT');
            if (eventUpdate) events.push('UPDATE');
            if (eventDelete) events.push('DELETE');
            if (eventTruncate) events.push('TRUNCATE');

            let funcData;
            try {
                funcData = JSON.parse(triggerFunction);
            } catch {
                funcData = { schema: '', name: '' };
            }

            const triggerDef = {
                name: triggerName,
                timing,
                events,
                level,
                functionSchema: funcData.schema,
                functionName: funcData.name,
                functionArgs: functionArgs || undefined,
                whenCondition: whenCondition || undefined
            };

            vscode.postMessage({ command: 'previewSql', triggerDef });
        } else {
            setSqlPreview('');
        }
    }, [triggerName, timing, eventInsert, eventUpdate, eventDelete, eventTruncate, level, triggerFunction, functionArgs, whenCondition]);

    const handleSubmit = () => {
        if (!triggerName.trim()) {
            setError('Trigger name is required');
            return;
        }

        if (!triggerFunction) {
            setError('Trigger function is required');
            return;
        }

        if (!eventInsert && !eventUpdate && !eventDelete && !eventTruncate) {
            setError('At least one event must be selected');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const events = [];
        if (eventInsert) events.push('INSERT');
        if (eventUpdate) events.push('UPDATE');
        if (eventDelete) events.push('DELETE');
        if (eventTruncate) events.push('TRUNCATE');

        let funcData;
        try {
            funcData = JSON.parse(triggerFunction);
        } catch {
            setError('Invalid trigger function selected');
            setIsSubmitting(false);
            return;
        }

        const triggerDef = {
            name: triggerName,
            timing,
            events,
            level,
            functionSchema: funcData.schema,
            functionName: funcData.name,
            functionArgs: functionArgs || undefined,
            whenCondition: whenCondition || undefined
        };

        vscode.postMessage({ command: 'createTrigger', triggerDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    // Create function options
    const functionOptions = [
        { value: '', label: '-- Select a function --' },
        ...availableFunctions.map(func => ({
            value: JSON.stringify({ schema: func.schema_name, name: func.function_name }),
            label: `${func.schema_name}.${func.function_name}`
        }))
    ];

    return (
        <div style={{ ...layouts.container, maxWidth: '900px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create Trigger on {schema}.{tableName}
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

            <Section title="Trigger Details">
                <Input
                    label="Trigger Name"
                    value={triggerName}
                    onChange={(e) => setTriggerName(e.target.value)}
                    placeholder="tr_tablename_action"
                    helperText="Naming convention: tr_tablename_action (e.g., tr_users_update)"
                    required
                />

                <Select
                    label="Timing"
                    value={timing}
                    onChange={(e) => setTiming(e.target.value)}
                    options={TIMING_OPTIONS}
                    required
                    helperText="When the trigger fires relative to the event"
                />

                <div>
                    <label style={{ display: 'block', marginBottom: spacing.sm, fontSize: '13px', fontWeight: '500' }}>
                        Events <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', gap: spacing.md, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={eventInsert}
                                onChange={(e) => setEventInsert(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px' }}>INSERT</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={eventUpdate}
                                onChange={(e) => setEventUpdate(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px' }}>UPDATE</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={eventDelete}
                                onChange={(e) => setEventDelete(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px' }}>DELETE</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={eventTruncate}
                                onChange={(e) => setEventTruncate(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px' }}>TRUNCATE</span>
                        </label>
                    </div>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic',
                        marginTop: spacing.sm
                    }}>
                        Select at least one event that will fire the trigger
                    </div>
                </div>

                <Select
                    label="Trigger Level"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    options={LEVEL_OPTIONS}
                    required
                    helperText="Whether to fire once per row or once per statement"
                />
            </Section>

            <Section title="Trigger Function">
                <Select
                    label="Function"
                    value={triggerFunction}
                    onChange={(e) => setTriggerFunction(e.target.value)}
                    options={functionOptions}
                    required
                    helperText="Function must return type TRIGGER"
                />

                <Input
                    label="Function Arguments (Optional)"
                    value={functionArgs}
                    onChange={(e) => setFunctionArgs(e.target.value)}
                    placeholder="'arg1', 'arg2'"
                    helperText="Comma-separated arguments to pass to the trigger function"
                />
            </Section>

            <CollapsibleSection title="WHEN Condition (Optional)" defaultOpen={false}>
                <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: '500' }}>
                        Condition Expression
                    </label>
                        <textarea
                            value={whenCondition}
                            onChange={(e) => setWhenCondition(e.target.value)}
                            placeholder="e.g., NEW.status != OLD.status"
                            rows={3}
                            style={{
                                width: '100%',
                                maxWidth: '500px',
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
                            Boolean expression to filter when trigger executes. Use OLD and NEW to reference row values.
                        </div>
                </div>

                {availableColumns.length > 0 && (
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: '500', marginBottom: spacing.sm }}>
                            Available Columns:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
                            {availableColumns.map(col => (
                                <span
                                    key={col.column_name}
                                    style={{
                                        backgroundColor: 'var(--vscode-badge-background)',
                                        color: 'var(--vscode-badge-foreground)',
                                        padding: '4px 8px',
                                        borderRadius: '3px',
                                        fontSize: '11px'
                                    }}
                                >
                                    {col.column_name} ({col.data_type})
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Create Trigger"
                loading={isSubmitting}
            />
        </div>
    );
};

