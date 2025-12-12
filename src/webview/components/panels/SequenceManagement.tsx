import React, { useState, useEffect } from 'react';
import { Section, Input, Select, CollapsibleSection, ActionButtons, SqlPreview, useScrollToError } from '../shared';
import { spacing, layouts, componentStyles } from '../../design-system';

// Access vscode from window (acquired in HTML before React loads)
const vscode = (window as any).vscode;

const DATA_TYPES = [
    { value: 'SMALLINT', label: 'SMALLINT' },
    { value: 'INTEGER', label: 'INTEGER' },
    { value: 'BIGINT', label: 'BIGINT' }
];

interface SequenceDefinition {
    name: string;
    schema: string;
    dataType?: string;
    startValue?: number;
    incrementBy?: number;
    minValue?: number;
    maxValue?: number;
    cache?: number;
    cycle?: boolean;
}

interface CreateSequenceProps {
    schema: string;
}

interface EditSequenceProps {
    schema: string;
    sequenceName: string;
    currentProps: {
        data_type?: string;
        current_value?: string;
        start_value?: string;
        minimum_value?: string;
        maximum_value?: string;
        increment?: string;
        cache_value?: string;
        cycle?: boolean;
    };
}

export const CreateSequenceComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as CreateSequenceProps;
    
    const [sequenceName, setSequenceName] = useState('');
    const [dataType, setDataType] = useState('BIGINT');
    const [minValue, setMinValue] = useState('');
    const [maxValue, setMaxValue] = useState('');
    const [startValue, setStartValue] = useState('');
    const [incrementBy, setIncrementBy] = useState('1');
    const [cache, setCache] = useState('1');
    const [cycle, setCycle] = useState(false);
    
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
        if (sequenceName) {
            const seqDef: SequenceDefinition = {
                name: sequenceName,
                schema: initialData.schema,
                dataType,
                startValue: startValue ? parseInt(startValue) : undefined,
                incrementBy: incrementBy ? parseInt(incrementBy) : 1,
                minValue: minValue ? parseInt(minValue) : undefined,
                maxValue: maxValue ? parseInt(maxValue) : undefined,
                cache: cache ? parseInt(cache) : 1,
                cycle
            };
            vscode.postMessage({ command: 'previewSql', seqDef });
        } else {
            setSqlPreview('');
        }
    }, [sequenceName, dataType, minValue, maxValue, startValue, incrementBy, cache, cycle, initialData.schema]);

    const handleSubmit = () => {
        if (!sequenceName.trim()) {
            setError('Sequence name is required');
            return;
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sequenceName)) {
            setError('Sequence name must start with a letter or underscore and contain only letters, numbers, and underscores');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const seqDef: SequenceDefinition = {
            name: sequenceName,
            schema: initialData.schema,
            dataType,
            startValue: startValue ? parseInt(startValue) : undefined,
            incrementBy: incrementBy ? parseInt(incrementBy) : 1,
            minValue: minValue ? parseInt(minValue) : undefined,
            maxValue: maxValue ? parseInt(maxValue) : undefined,
            cache: cache ? parseInt(cache) : 1,
            cycle
        };

        vscode.postMessage({ command: 'createSequence', seqDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '900px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create Sequence in {initialData.schema}
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
                        label="Sequence Name"
                        value={sequenceName}
                        onChange={(e) => setSequenceName(e.target.value)}
                        placeholder="my_sequence"
                        helperText="Name must start with a letter and contain only letters, numbers, and underscores"
                        required
                        style={{ maxWidth: '500px' }}
                    />

                    <Select
                        label="Data Type"
                        value={dataType}
                        onChange={(e) => setDataType(e.target.value)}
                        options={DATA_TYPES}
                        helperText="The data type of the sequence (BIGINT is recommended for most use cases)"
                        style={{ maxWidth: '500px' }}
                    />
                </div>
            </Section>

            <CollapsibleSection title="Sequence Options" defaultExpanded={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
                        <Input
                            label="Minimum Value"
                            type="number"
                            value={minValue}
                            onChange={(e) => setMinValue(e.target.value)}
                            placeholder="Leave empty for NO MINVALUE"
                            helperText="Minimum value of the sequence (or leave empty)"
                        />

                        <Input
                            label="Maximum Value"
                            type="number"
                            value={maxValue}
                            onChange={(e) => setMaxValue(e.target.value)}
                            placeholder="Leave empty for NO MAXVALUE"
                            helperText="Maximum value of the sequence (or leave empty)"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
                        <Input
                            label="Start Value"
                            type="number"
                            value={startValue}
                            onChange={(e) => setStartValue(e.target.value)}
                            placeholder="1"
                            helperText="Initial value of the sequence (defaults to 1)"
                        />

                        <Input
                            label="Increment By"
                            type="number"
                            value={incrementBy}
                            onChange={(e) => setIncrementBy(e.target.value)}
                            helperText="Value to add to current sequence value (can be negative)"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
                        <Input
                            label="Cache Size"
                            type="number"
                            value={cache}
                            onChange={(e) => setCache(e.target.value)}
                            helperText="Number of sequence values to pre-allocate (improves performance)"
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                        <input
                            type="checkbox"
                            id="cycle"
                            checked={cycle}
                            onChange={(e) => setCycle(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor="cycle" style={{ cursor: 'pointer', margin: 0 }}>
                            Cycle
                        </label>
                    </div>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic',
                        marginTop: '-8px'
                    }}>
                        Allow sequence to wrap around when reaching max/min value
                    </div>
                </div>
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Create Sequence"
                loading={isSubmitting}
            />
        </div>
    );
};

export const EditSequenceComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as EditSequenceProps;
    
    const [sequenceName, setSequenceName] = useState(initialData.sequenceName || '');
    const [dataType, setDataType] = useState(initialData.currentProps?.data_type || 'BIGINT');
    const [currentValue, setCurrentValue] = useState(
        initialData.currentProps?.current_value || initialData.currentProps?.start_value || '1'
    );
    const [minValue, setMinValue] = useState(initialData.currentProps?.minimum_value || '');
    const [maxValue, setMaxValue] = useState(initialData.currentProps?.maximum_value || '');
    const [startValue] = useState(initialData.currentProps?.start_value || '1');
    const [incrementBy, setIncrementBy] = useState(initialData.currentProps?.increment || '1');
    const [cache, setCache] = useState(initialData.currentProps?.cache_value || '1');
    const [cycle, setCycle] = useState(initialData.currentProps?.cycle || false);
    
    // Store original values for change detection
    const originalSequenceName = initialData.sequenceName || '';
    const originalDataType = initialData.currentProps?.data_type || 'BIGINT';
    const originalCurrentValue = initialData.currentProps?.current_value || initialData.currentProps?.start_value || '1';
    const originalMinValue = initialData.currentProps?.minimum_value || '';
    const originalMaxValue = initialData.currentProps?.maximum_value || '';
    const originalIncrementBy = initialData.currentProps?.increment || '1';
    const originalCache = initialData.currentProps?.cache_value || '1';
    const originalCycle = initialData.currentProps?.cycle || false;
    
    const [error, setError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    // Check if any changes have been made
    const hasChanges = (): boolean => {
        if (sequenceName !== originalSequenceName) return true;
        if (dataType !== originalDataType) return true;
        if (currentValue !== originalCurrentValue) return true;
        if (minValue !== originalMinValue) return true;
        if (maxValue !== originalMaxValue) return true;
        if (incrementBy !== originalIncrementBy) return true;
        if (cache !== originalCache) return true;
        if (cycle !== originalCycle) return true;
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

        const seqDef = {
            originalName: initialData.sequenceName,
            name: sequenceName,
            schema: initialData.schema,
            dataType,
            currentValue: currentValue ? parseInt(currentValue) : undefined,
            incrementBy: incrementBy ? parseInt(incrementBy) : 1,
            minValue: minValue ? parseInt(minValue) : undefined,
            maxValue: maxValue ? parseInt(maxValue) : undefined,
            cache: cache ? parseInt(cache) : 1,
            cycle
        };
        vscode.postMessage({ command: 'previewAlterSql', seqDef });
    }, [sequenceName, dataType, currentValue, minValue, maxValue, incrementBy, cache, cycle, initialData.schema, initialData.sequenceName]);

    const handleSubmit = () => {
        if (!sequenceName.trim()) {
            setError('Sequence name is required');
            return;
        }

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(sequenceName)) {
            setError('Sequence name must start with a letter or underscore and contain only letters, numbers, and underscores');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const seqDef = {
            originalName: initialData.sequenceName,
            name: sequenceName,
            schema: initialData.schema,
            dataType,
            currentValue: currentValue ? parseInt(currentValue) : undefined,
            incrementBy: incrementBy ? parseInt(incrementBy) : 1,
            minValue: minValue ? parseInt(minValue) : undefined,
            maxValue: maxValue ? parseInt(maxValue) : undefined,
            cache: cache ? parseInt(cache) : 1,
            cycle
        };

        vscode.postMessage({ command: 'alterSequence', seqDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '900px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Edit Sequence
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
                        label="Schema"
                        value={initialData.schema}
                        disabled
                        style={{ maxWidth: '500px' }}
                    />

                    <Input
                        label="Sequence Name"
                        value={sequenceName}
                        onChange={(e) => setSequenceName(e.target.value)}
                        helperText="Changing the name will rename the sequence"
                        required
                        style={{ maxWidth: '500px' }}
                    />

                    <Select
                        label="Data Type"
                        value={dataType}
                        onChange={(e) => setDataType(e.target.value)}
                        options={DATA_TYPES}
                        helperText="The data type of the sequence (BIGINT is recommended for most use cases)"
                        style={{ maxWidth: '500px' }}
                    />
                </div>
            </Section>

            <CollapsibleSection title="Sequence Options" defaultExpanded={true}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
                        <Input
                            label="Minimum Value"
                            type="number"
                            value={minValue}
                            onChange={(e) => setMinValue(e.target.value)}
                            helperText="Minimum value of the sequence"
                        />

                        <Input
                            label="Maximum Value"
                            type="number"
                            value={maxValue}
                            onChange={(e) => setMaxValue(e.target.value)}
                            helperText="Maximum value of the sequence"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
                        <Input
                            label="Start Value"
                            value={startValue}
                            disabled
                            helperText="Initial value of the sequence (read-only)"
                        />

                        <Input
                            label="Increment By"
                            type="number"
                            value={incrementBy}
                            onChange={(e) => setIncrementBy(e.target.value)}
                            helperText="Value to add to current sequence value (can be negative)"
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md }}>
                        <Input
                            label="Cache Size"
                            type="number"
                            value={cache}
                            onChange={(e) => setCache(e.target.value)}
                            helperText="Number of sequence values to pre-allocate (improves performance)"
                        />

                        <Input
                            label="Current Value"
                            type="number"
                            value={currentValue}
                            onChange={(e) => setCurrentValue(e.target.value)}
                            helperText="The current value of the sequence (next value to be returned)"
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                        <input
                            type="checkbox"
                            id="cycle"
                            checked={cycle}
                            onChange={(e) => setCycle(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        <label htmlFor="cycle" style={{ cursor: 'pointer', margin: 0 }}>
                            Cycle
                        </label>
                    </div>
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic',
                        marginTop: '-8px'
                    }}>
                        Allow sequence to wrap around when reaching max/min value
                    </div>
                </div>
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Update Sequence"
                loading={isSubmitting}
                saveDisabled={isSubmitting || !hasChanges()}
            />
        </div>
    );
};

