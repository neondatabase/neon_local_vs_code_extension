import React, { useState, useEffect } from 'react';
import { 
    Input, 
    Select, 
    Section, 
    ActionButtons,
    Button,
    useScrollToError
} from '../shared';
import { layouts, spacing, componentStyles } from '../../design-system';

interface ExportDataProps {
    schema: string;
    tableName: string;
}

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

export const ExportDataView: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as ExportDataProps;
    
    const [schema] = useState(initialData.schema || '');
    const [tableName] = useState(initialData.tableName || '');
    
    const [exportType, setExportType] = useState<'table' | 'query'>('table');
    const [sqlQuery, setSqlQuery] = useState('');
    const [fileFormat, setFileFormat] = useState<'csv' | 'json' | 'sql'>('csv');
    const [filePath, setFilePath] = useState('');
    const [includeHeaders, setIncludeHeaders] = useState(true);
    const [delimiter, setDelimiter] = useState(',');
    const [quoteChar, setQuoteChar] = useState('"');
    const [nullValue, setNullValue] = useState('');
    
    // SQL-specific options
    const [targetSchema, setTargetSchema] = useState(initialData.schema || '');
    const [targetTable, setTargetTable] = useState(initialData.tableName || '');
    
    // Helper to change file extension
    const changeFileExtension = (path: string, newExt: string): string => {
        if (!path) return '';
        const lastDot = path.lastIndexOf('.');
        const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        
        if (lastDot > lastSlash) {
            return path.substring(0, lastDot + 1) + newExt;
        }
        return path + '.' + newExt;
    };
    
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressText, setProgressText] = useState('');

    const errorRef = useScrollToError(error);

    // Prepopulate SQL query when export type changes to 'query'
    useEffect(() => {
        if (exportType === 'query' && !sqlQuery) {
            setSqlQuery(`SELECT *\nFROM ${schema}.${tableName}`);
        }
    }, [exportType, schema, tableName, sqlQuery]);

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'fileSelected':
                    setFilePath(message.filePath);
                    setError('');
                    break;
                case 'exportProgress':
                    setProgress(message.progress);
                    setProgressText(message.text);
                    break;
                case 'exportComplete':
                    setIsSubmitting(false);
                    setProgress(100);
                    setProgressText(`Export completed successfully! File saved to: ${message.filePath}`);
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
    }, []);

    const handleSelectFile = () => {
        const ext = fileFormat === 'csv' ? 'csv' : fileFormat === 'json' ? 'json' : 'sql';
        vscode.postMessage({ 
            command: 'selectFile',
            defaultFileName: `${tableName}_export.${ext}`,
            fileFormat
        });
    };
    
    const handleFileFormatChange = (newFormat: 'csv' | 'json' | 'sql') => {
        setFileFormat(newFormat);
        
        // Update file extension if a file has been selected
        if (filePath) {
            const newExt = newFormat === 'csv' ? 'csv' : newFormat === 'json' ? 'json' : 'sql';
            const newPath = changeFileExtension(filePath, newExt);
            setFilePath(newPath);
        }
    };

    const handleExport = () => {
        if (!filePath) {
            setError('Please select a destination file');
            return;
        }

        if (exportType === 'query' && !sqlQuery.trim()) {
            setError('Please enter a SQL query');
            return;
        }

        setError('');
        setIsSubmitting(true);
        setProgress(0);
        setProgressText('Starting export...');

        vscode.postMessage({
            command: 'export',
            options: {
                schema,
                tableName: exportType === 'table' ? tableName : undefined,
                sqlQuery: exportType === 'query' ? sqlQuery : undefined,
                fileFormat,
                filePath,
                includeHeaders: fileFormat === 'csv' ? includeHeaders : false,
                delimiter: fileFormat === 'csv' ? delimiter : ',',
                quoteChar: fileFormat === 'csv' ? quoteChar : '"',
                nullValue,
                targetSchema: fileFormat === 'sql' ? targetSchema : undefined,
                targetTable: fileFormat === 'sql' ? targetTable : undefined
            }
        });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Export Data from {schema}.{tableName}
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

            <Section title="Export Source">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Select
                        label="Export Type"
                        value={exportType}
                        onChange={(e) => setExportType(e.target.value as 'table' | 'query')}
                        options={[
                            { value: 'table', label: 'Entire Table' },
                            { value: 'query', label: 'Custom SQL Query' }
                        ]}
                        fullWidth
                    />

                    {exportType === 'query' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
                            <label style={{ fontSize: '13px', fontWeight: '500' }}>SQL Query</label>
                            <textarea
                                value={sqlQuery}
                                onChange={(e) => setSqlQuery(e.target.value)}
                                placeholder="SELECT * FROM table WHERE condition"
                                rows={6}
                                style={{
                                    width: '100%',
                                    padding: spacing.sm,
                                    fontSize: '13px',
                                    backgroundColor: 'var(--vscode-input-background)',
                                    color: 'var(--vscode-input-foreground)',
                                    border: '1px solid var(--vscode-input-border)',
                                    borderRadius: '4px',
                                    outline: 'none',
                                    fontFamily: 'var(--vscode-editor-font-family, monospace)',
                                    resize: 'vertical',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                    )}
                </div>
            </Section>

            <Section title="Export Format">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Select
                        label="File Format"
                        value={fileFormat}
                        onChange={(e) => handleFileFormatChange(e.target.value as 'csv' | 'json' | 'sql')}
                        options={[
                            { value: 'csv', label: 'CSV' },
                            { value: 'json', label: 'JSON' },
                            { value: 'sql', label: 'SQL (INSERT statements)' }
                        ]}
                    />

                    <div>
                        <label style={{ 
                            display: 'block', 
                            fontSize: '13px', 
                            fontWeight: '500', 
                            marginBottom: spacing.xs 
                        }}>
                            Destination File
                        </label>
                        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                            <Input
                                value={filePath}
                                readOnly
                                placeholder="No file selected"
                                fullWidth
                                noWrapper
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
                                checked={includeHeaders}
                                onChange={(e) => setIncludeHeaders(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span>Include header row</span>
                        </label>
                    </div>
                </Section>
            )}

            {fileFormat === 'sql' && (
                <Section title="SQL Options">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                        <div style={{ display: 'flex', gap: spacing.md }}>
                            <Input
                                label="Target Schema"
                                value={targetSchema}
                                onChange={(e) => setTargetSchema(e.target.value)}
                                placeholder="Schema name"
                                style={{ flex: 1 }}
                            />
                            <Input
                                label="Target Table"
                                value={targetTable}
                                onChange={(e) => setTargetTable(e.target.value)}
                                placeholder="Table name"
                                style={{ flex: 1 }}
                            />
                        </div>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic'
                        }}>
                            These values will be used in the generated INSERT statements
                        </div>
                    </div>
                </Section>
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
                onSave={handleExport}
                saveLabel="Export Data"
                loading={isSubmitting}
                loadingText="Exporting..."
                saveDisabled={!filePath || isSubmitting || (exportType === 'query' && !sqlQuery.trim())}
            />
        </div>
    );
};

