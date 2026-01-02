import React, { useState, useEffect } from 'react';
import { 
    Input, 
    Select, 
    Section, 
    ActionButtons,
    Button,
    CollapsibleSection,
    useScrollToError
} from '../shared';
import { layouts, spacing, colors, borderRadius, fontSize, componentStyles } from '../../design-system';

interface Column {
    name: string;
    type: string;
}

interface ImportDataProps {
    schema: string;
    tableName: string;
    columns: Column[];
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

export const ImportDataView: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ImportDataProps;
    
    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    const [columns] = useState<Column[]>(initialData.columns || []);
    
    const [fileFormat, setFileFormat] = useState<'csv' | 'json'>('csv');
    const [filePath, setFilePath] = useState('');
    const [skipFirstRow, setSkipFirstRow] = useState(true);
    const [delimiter, setDelimiter] = useState(',');
    const [quoteChar, setQuoteChar] = useState('"');
    const [nullValue, setNullValue] = useState('');
    const [truncateBeforeImport, setTruncateBeforeImport] = useState(false);
    
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [previewColumns, setPreviewColumns] = useState<string[]>([]);
    const [showPreview, setShowPreview] = useState(false);
    
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');

    const errorRef = useScrollToError(error);

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'fileSelected':
                    setFilePath(message.filePath);
                    setError('');
                    // Automatically trigger preview when file is selected
                    vscode.postMessage({
                        command: 'previewFile',
                        filePath: message.filePath,
                        fileFormat,
                        delimiter: fileFormat === 'csv' ? delimiter : undefined
                    });
                    break;
                case 'previewData':
                    setPreviewData(message.data);
                    setPreviewColumns(message.columns);
                    setShowPreview(true);
                    break;
                case 'importProgress':
                    setProgress(message.progress);
                    setProgressText(message.text);
                    break;
                case 'importComplete':
                    setIsSubmitting(false);
                    setProgress(100);
                    setProgressText('Import completed successfully!');
                    break;
                case 'error':
                    setError(message.error);
                    setIsSubmitting(false);
                    setProgress(0);
                    setProgressText('');
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, [fileFormat, delimiter]);

    // Automatically refresh preview when format or delimiter changes
    useEffect(() => {
        if (filePath) {
            vscode.postMessage({
                command: 'previewFile',
                filePath,
                fileFormat,
                delimiter: fileFormat === 'csv' ? delimiter : undefined
            });
        }
    }, [fileFormat, delimiter, filePath]);

    const handleSelectFile = () => {
        vscode.postMessage({ 
            command: 'selectFile',
            fileFormat: fileFormat 
        });
    };

    const handleImport = () => {
        if (!filePath) {
            setError('Please select a file to import');
            return;
        }

        setError('');
        setIsSubmitting(true);
        setProgress(0);
        setProgressText('Starting import...');

        vscode.postMessage({
            command: 'import',
            options: {
                schema,
                tableName,
                fileFormat,
                filePath,
                skipFirstRow: fileFormat === 'csv' ? skipFirstRow : false,
                delimiter: fileFormat === 'csv' ? delimiter : ',',
                quoteChar: fileFormat === 'csv' ? quoteChar : '"',
                nullValue,
                truncateBeforeImport
            }
        });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Import Data into {schema}.{tableName}
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

            <Section title="Select File">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Select
                        label="File Format"
                        value={fileFormat}
                        onChange={(e) => setFileFormat(e.target.value as 'csv' | 'json')}
                        options={[
                            { value: 'csv', label: 'CSV' },
                            { value: 'json', label: 'JSON' }
                        ]}
                    />

                    <div>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '13px', 
                            fontWeight: '500', 
                            marginBottom: spacing.xs 
                        }}>
                            File Path
                            <span style={{ color: 'var(--vscode-errorForeground)', marginLeft: '2px' }}>*</span>
                        </label>
                        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                            <Input
                                value={filePath}
                                readOnly
                                placeholder="No file selected"
                                fullWidth
                                noWrapper
                                required
                            />
                            <Button onClick={handleSelectFile} style={{ minWidth: '120px', flexShrink: 0 }}>
                                Browse...
                            </Button>
                        </div>
                    </div>
                </div>
            </Section>

            {fileFormat === 'csv' && (
                <Section title="CSV Options">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <div style={{ display: 'flex', gap: spacing.md }}>
                            <Input
                                label="Delimiter"
                                value={delimiter}
                                onChange={(e) => setDelimiter(e.target.value)}
                                placeholder=","
                                style={{ flex: 1 }}
                            />
                            <Input
                                label="Quote Character"
                                value={quoteChar}
                                onChange={(e) => setQuoteChar(e.target.value)}
                                placeholder='"'
                                style={{ flex: 1 }}
                            />
                            <Input
                                label="NULL Value"
                                value={nullValue}
                                onChange={(e) => setNullValue(e.target.value)}
                                placeholder="(empty string)"
                                style={{ flex: 1 }}
                            />
                        </div>

                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={skipFirstRow}
                                onChange={(e) => setSkipFirstRow(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span>Skip first row (header row)</span>
                        </label>
                    </div>
                </Section>
            )}

            <Section title="Import Options">
                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={truncateBeforeImport}
                        onChange={(e) => setTruncateBeforeImport(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                    />
                    <span>Truncate table before import</span>
                </label>
                <div style={{ 
                    marginTop: spacing.sm, 
                    fontSize: '12px', 
                    color: 'var(--vscode-descriptionForeground)' 
                }}>
                    Warning: This will delete all existing data in the table before importing.
                </div>
            </Section>

            {showPreview && previewData.length > 0 && (
                <CollapsibleSection title="File Preview (First 10 rows)" defaultOpen={true}>
                    <div style={{ 
                        backgroundColor: colors.backgroundDark,
                        border: `1px solid ${colors.border}`,
                        borderRadius: borderRadius.md,
                        padding: spacing.md,
                        overflow: 'auto',
                        maxHeight: '400px',
                        fontSize: fontSize.sm,
                        fontFamily: 'var(--vscode-editor-font-family)'
                    }}>
                        <table style={{ 
                            width: '100%', 
                            borderCollapse: 'collapse',
                            fontSize: fontSize.sm
                        }}>
                            <thead>
                                <tr>
                                    {previewColumns.map((col, idx) => (
                                        <th key={idx} style={{
                                            padding: spacing.sm,
                                            borderBottom: `2px solid ${colors.border}`,
                                            backgroundColor: colors.backgroundLight,
                                            textAlign: 'left',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                            fontWeight: 600
                                        }}>
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {previewData.map((row, rowIdx) => (
                                    <tr key={rowIdx} style={{
                                        borderBottom: `1px solid ${colors.border}`
                                    }}>
                                        {previewColumns.map((col, colIdx) => (
                                            <td key={colIdx} style={{
                                                padding: spacing.sm,
                                                color: colors.foreground
                                            }}>
                                                {String(row[col] ?? '')}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </CollapsibleSection>
            )}

            {progress > 0 && (
                <div style={{ marginBottom: spacing.lg }}>
                    <div style={{
                        width: '100%',
                        height: '20px',
                        backgroundColor: 'var(--vscode-input-background)',
                        border: '1px solid var(--vscode-input-border)',
                        borderRadius: '4px',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            height: '100%',
                            backgroundColor: 'var(--vscode-progressBar-background)',
                            width: `${progress}%`,
                            transition: 'width 0.3s ease'
                        }} />
                    </div>
                    {progressText && (
                        <div style={{ 
                            textAlign: 'center', 
                            marginTop: spacing.sm,
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)'
                        }}>
                            {progressText}
                        </div>
                    )}
                </div>
            )}

            <ActionButtons
                onSave={handleImport}
                saveLabel="Import Data"
                loading={isSubmitting}
                loadingText="Importing..."
                saveDisabled={!filePath || isSubmitting}
            />
        </div>
    );
};

