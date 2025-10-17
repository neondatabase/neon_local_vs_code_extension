import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { SchemaService } from './services/schema.service';
import { getStyles } from './templates/styles';
import * as path from 'path';
import * as fs from 'fs';

export interface ImportOptions {
    schema: string;
    tableName: string;
    fileFormat: 'csv' | 'json';
    filePath: string;
    columnMapping?: { [key: string]: string };
    skipFirstRow: boolean;
    delimiter: string;
    quoteChar: string;
    nullValue: string;
    truncateBeforeImport: boolean;
}

export interface ExportOptions {
    schema: string;
    tableName?: string;
    sqlQuery?: string;
    fileFormat: 'csv' | 'json' | 'sql';
    filePath: string;
    includeHeaders: boolean;
    delimiter: string;
    quoteChar: string;
    nullValue: string;
}

export class DataImportExportPanel {
    private static extractErrorMessage(error: any): string {
        // Handle PostgreSQL error objects
        if (error && typeof error === 'object' && 'message' in error) {
            return error.message;
        }
        // Handle Error instances
        if (error instanceof Error) {
            return error.message;
        }
        // Handle string errors
        if (typeof error === 'string') {
            return error;
        }
        // Fallback: try to stringify
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    public static currentPanels = new Map<string, vscode.WebviewPanel>();

    /**
     * Show import data interface
     */
    public static async showImport(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `import_${database || 'default'}.${schema}.${tableName}`;
        
        if (DataImportExportPanel.currentPanels.has(key)) {
            DataImportExportPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'importData',
            `Import Data: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        DataImportExportPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            DataImportExportPanel.currentPanels.delete(key);
        });

        try {
            // Get table columns
            const schemaService = new SchemaService(stateService, context);
            const columns = await schemaService.getColumns(database || 'postgres', schema, tableName);
            
            panel.webview.html = DataImportExportPanel.getImportHtml(
                schema,
                tableName,
                columns.map(col => ({ name: col.name, type: col.data_type }))
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'selectFile':
                        const fileUri = await vscode.window.showOpenDialog({
                            canSelectMany: false,
                            filters: {
                                'CSV Files': ['csv'],
                                'JSON Files': ['json'],
                                'All Files': ['*']
                            },
                            title: 'Select file to import'
                        });
                        
                        if (fileUri && fileUri[0]) {
                            panel.webview.postMessage({
                                command: 'fileSelected',
                                filePath: fileUri[0].fsPath
                            });
                        }
                        break;
                        
                    case 'previewFile':
                        await DataImportExportPanel.previewFile(
                            message.filePath,
                            message.fileFormat,
                            message.delimiter,
                            panel
                        );
                        break;
                        
                    case 'import':
                        await DataImportExportPanel.executeImport(
                            context,
                            stateService,
                            message.options,
                            database,
                            panel
                        );
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show import interface: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Show export data interface
     */
    public static async showExport(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `export_${database || 'default'}.${schema}.${tableName}`;
        
        if (DataImportExportPanel.currentPanels.has(key)) {
            DataImportExportPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'exportData',
            `Export Data: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        DataImportExportPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            DataImportExportPanel.currentPanels.delete(key);
        });

        try {
            panel.webview.html = DataImportExportPanel.getExportHtml(schema, tableName);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'selectFile':
                        const fileUri = await vscode.window.showSaveDialog({
                            defaultUri: vscode.Uri.file(`${tableName}.${message.format}`),
                            filters: {
                                'CSV Files': ['csv'],
                                'JSON Files': ['json'],
                                'SQL Files': ['sql'],
                                'All Files': ['*']
                            },
                            title: 'Select export destination'
                        });
                        
                        if (fileUri) {
                            panel.webview.postMessage({
                                command: 'fileSelected',
                                filePath: fileUri.fsPath
                            });
                        }
                        break;
                        
                    case 'export':
                        await DataImportExportPanel.executeExport(
                            context,
                            stateService,
                            message.options,
                            database,
                            panel
                        );
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show export interface: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Preview file contents
     */
    private static async previewFile(
        filePath: string,
        fileFormat: string,
        delimiter: string,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            let preview: any;
            
            if (fileFormat === 'csv') {
                const lines = content.split('\n').slice(0, 6); // Preview first 6 lines
                const rows = lines.map(line => {
                    // Simple CSV parsing (doesn't handle quoted delimiters)
                    return line.split(delimiter).map(cell => cell.trim());
                });
                preview = { type: 'csv', rows };
            } else if (fileFormat === 'json') {
                const data = JSON.parse(content);
                const items = Array.isArray(data) ? data.slice(0, 5) : [data];
                preview = { type: 'json', items };
            }
            
            panel.webview.postMessage({
                command: 'previewData',
                preview
            });
            
        } catch (error) {
            panel.webview.postMessage({
                command: 'error',
                error: `Failed to preview file: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    /**
     * Execute import
     */
    private static async executeImport(
        context: vscode.ExtensionContext,
        stateService: StateService,
        options: ImportOptions,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Read file
            const content = fs.readFileSync(options.filePath, 'utf-8');
            
            // Truncate if requested
            if (options.truncateBeforeImport) {
                await sqlService.executeQuery(
                    `TRUNCATE TABLE ${options.schema}.${options.tableName};`,
                    database
                );
            }
            
            let insertedRows = 0;
            
            if (options.fileFormat === 'csv') {
                // Parse CSV
                const lines = content.split('\n').filter(line => line.trim());
                const startIndex = options.skipFirstRow ? 1 : 0;
                
                // Get headers from first row or use column mapping
                const headers = options.skipFirstRow 
                    ? lines[0].split(options.delimiter).map(h => h.trim().replace(/^"|"$/g, ''))
                    : Object.keys(options.columnMapping || {});
                
                // Process in batches
                const batchSize = 100;
                for (let i = startIndex; i < lines.length; i += batchSize) {
                    const batch = lines.slice(i, Math.min(i + batchSize, lines.length));
                    const values: string[] = [];
                    
                    for (const line of batch) {
                        const cells = DataImportExportPanel.parseCSVLine(line, options.delimiter, options.quoteChar);
                        const rowValues = cells.map(cell => {
                            if (cell === options.nullValue || cell === '') {
                                return 'NULL';
                            }
                            return `'${cell.replace(/'/g, "''")}'`;
                        });
                        values.push(`(${rowValues.join(', ')})`);
                    }
                    
                    if (values.length > 0) {
                        const columns = headers.join(', ');
                        const sql = `INSERT INTO ${options.schema}.${options.tableName} (${columns}) VALUES ${values.join(', ')};`;
                        await sqlService.executeQuery(sql, database);
                        insertedRows += values.length;
                        
                        // Update progress
                        panel.webview.postMessage({
                            command: 'progress',
                            current: i + batch.length,
                            total: lines.length - startIndex
                        });
                    }
                }
                
            } else if (options.fileFormat === 'json') {
                // Parse JSON
                const data = JSON.parse(content);
                const items = Array.isArray(data) ? data : [data];
                
                // Process in batches
                const batchSize = 100;
                for (let i = 0; i < items.length; i += batchSize) {
                    const batch = items.slice(i, Math.min(i + batchSize, items.length));
                    const values: string[] = [];
                    
                    for (const item of batch) {
                        const columns = Object.keys(item);
                        const rowValues = columns.map(col => {
                            const value = item[col];
                            if (value === null || value === undefined) {
                                return 'NULL';
                            }
                            if (typeof value === 'object') {
                                return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
                            }
                            return `'${String(value).replace(/'/g, "''")}'`;
                        });
                        values.push(`(${rowValues.join(', ')})`);
                    }
                    
                    if (values.length > 0) {
                        const columns = Object.keys(batch[0]).join(', ');
                        const sql = `INSERT INTO ${options.schema}.${options.tableName} (${columns}) VALUES ${values.join(', ')};`;
                        await sqlService.executeQuery(sql, database);
                        insertedRows += values.length;
                        
                        // Update progress
                        panel.webview.postMessage({
                            command: 'progress',
                            current: i + batch.length,
                            total: items.length
                        });
                    }
                }
            }
            
            vscode.window.showInformationMessage(`Successfully imported ${insertedRows} rows into ${options.schema}.${options.tableName}`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            panel.webview.postMessage({
                command: 'error',
                error: `Import failed: ${errorMessage}`
            });
        }
    }

    /**
     * Execute export
     */
    private static async executeExport(
        context: vscode.ExtensionContext,
        stateService: StateService,
        options: ExportOptions,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Build query
            const query = options.sqlQuery || `SELECT * FROM ${options.schema}.${options.tableName}`;
            
            // Execute query
            const result = await sqlService.executeQuery(query, database);
            
            let content = '';
            
            if (options.fileFormat === 'csv') {
                // Export as CSV
                const headers = result.fields.map(f => f.name);
                
                if (options.includeHeaders) {
                    content += headers.map(h => `"${h}"`).join(options.delimiter) + '\n';
                }
                
                for (const row of result.rows) {
                    const values = headers.map(header => {
                        const value = row[header];
                        if (value === null || value === undefined) {
                            return options.nullValue;
                        }
                        const strValue = String(value);
                        // Quote if contains delimiter or quote char
                        if (strValue.includes(options.delimiter) || strValue.includes(options.quoteChar)) {
                            return `${options.quoteChar}${strValue.replace(new RegExp(options.quoteChar, 'g'), options.quoteChar + options.quoteChar)}${options.quoteChar}`;
                        }
                        return strValue;
                    });
                    content += values.join(options.delimiter) + '\n';
                }
                
            } else if (options.fileFormat === 'json') {
                // Export as JSON
                content = JSON.stringify(result.rows, null, 2);
                
            } else if (options.fileFormat === 'sql') {
                // Export as SQL INSERT statements
                const headers = result.fields.map(f => f.name);
                const tableName = options.tableName || 'exported_data';
                
                for (const row of result.rows) {
                    const values = headers.map(header => {
                        const value = row[header];
                        if (value === null || value === undefined) {
                            return 'NULL';
                        }
                        if (typeof value === 'number') {
                            return String(value);
                        }
                        return `'${String(value).replace(/'/g, "''")}'`;
                    });
                    content += `INSERT INTO ${options.schema}.${tableName} (${headers.join(', ')}) VALUES (${values.join(', ')});\n`;
                }
            }
            
            // Write to file
            fs.writeFileSync(options.filePath, content, 'utf-8');
            
            vscode.window.showInformationMessage(`Successfully exported ${result.rows.length} rows to ${path.basename(options.filePath)}`);
            panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            panel.webview.postMessage({
                command: 'error',
                error: `Export failed: ${errorMessage}`
            });
        }
    }

    /**
     * Parse CSV line with proper quote handling
     */
    private static parseCSVLine(line: string, delimiter: string, quoteChar: string): string[] {
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];
            
            if (char === quoteChar) {
                if (inQuotes && nextChar === quoteChar) {
                    // Escaped quote
                    current += quoteChar;
                    i++; // Skip next char
                } else {
                    // Toggle quotes
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                // End of cell
                cells.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        
        // Add last cell
        cells.push(current.trim());
        
        return cells;
    }

    /**
     * Get HTML for import panel
     */
    private static getImportHtml(
        schema: string,
        tableName: string,
        columns: Array<{ name: string; type: string }>
    ): string {
        const columnsJson = JSON.stringify(columns);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Import Data</title>
    ${getStyles()}
    <style>
        /* Consistent form field spacing */
        .section-box .checkbox-group {
            margin-bottom: 16px;
        }
        .section-box .info-text:last-child {
            margin-bottom: 0;
        }
        .section-box > button:not(.btn) {
            margin-top: 0;
        }
        #csvOptions {
            margin-bottom: 16px;
        }
        #csvOptions .form-group:last-child {
            margin-bottom: 0;
        }
        
        .file-input {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .file-input input {
            flex: 1;
        }
        .preview-box {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 12px;
            margin-top: 16px;
            max-height: 300px;
            overflow: auto;
        }
        .preview-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        .preview-table th,
        .preview-table td {
            padding: 6px;
            border: 1px solid var(--vscode-panel-border);
            text-align: left;
        }
        .preview-table th {
            background-color: var(--vscode-list-headerBackground);
        }
        .progress-bar {
            width: 100%;
            height: 20px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            overflow: hidden;
            margin-top: 16px;
        }
        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-background);
            width: 0%;
            transition: width 0.3s ease;
        }
        .progress-text {
            text-align: center;
            margin-top: 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        textarea {
            resize: vertical;
            font-family: var(--vscode-editor-font-family, monospace);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Import Data into ${schema}.${tableName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <h2 style="font-size: 14px; margin: 0 0 16px 0; font-weight: 600;">Select File</h2>
            
            <div class="form-group">
                <label>File Format</label>
                <select id="fileFormat">
                    <option value="csv">CSV (Comma Separated Values)</option>
                    <option value="json">JSON (JavaScript Object Notation)</option>
                </select>
            </div>

            <div class="form-group">
                <label>File Path</label>
                <div class="file-input">
                    <input type="text" id="filePath" readonly placeholder="Click Browse to select file" />
                    <button class="btn btn-secondary" id="browseBtn">Browse...</button>
                </div>
            </div>

            <button class="btn btn-secondary" id="previewBtn" disabled>Preview File</button>
            
            <div id="previewContainer"></div>
        </div>

        <div class="section-box">
            <h2 style="font-size: 14px; margin: 0 0 16px 0; font-weight: 600;">Import Options</h2>
            
            <div id="csvOptions">
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="skipFirstRow" checked />
                        <label for="skipFirstRow" style="margin: 0;">First row contains headers</label>
                    </div>
                </div>

                <div class="form-group">
                    <label>Delimiter</label>
                    <select id="delimiter">
                        <option value=",">Comma (,)</option>
                        <option value=";">Semicolon (;)</option>
                        <option value="\t">Tab</option>
                        <option value="|">Pipe (|)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Quote Character</label>
                    <input type="text" id="quoteChar" value='"' maxlength="1" />
                </div>
            </div>

            <div class="form-group">
                <label>NULL Value Representation</label>
                <input type="text" id="nullValue" placeholder="(empty string)" />
                <div class="info-text">How NULL values are represented in the file</div>
            </div>

            <div class="form-group">
                <div class="checkbox-group" style="margin-bottom: 8px;">
                    <input type="checkbox" id="truncateFirst" />
                    <label for="truncateFirst" style="margin: 0;">Truncate table before import</label>
                </div>
                <div class="info-text">Warning: This will delete all existing data in the table</div>
            </div>
        </div>

        <div class="section-box">
            <h2 style="font-size: 14px; margin: 0 0 16px 0; font-weight: 600;">Target Table Columns</h2>
            <div class="info-text">
                Table columns: ${columns.map(c => c.name).join(', ')}
            </div>
        </div>

        <div id="progressContainer" style="display: none;">
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
            <div class="progress-text" id="progressText">0 / 0 rows</div>
        </div>

        <div class="actions">
            <button class="btn" id="importBtn" disabled>Import Data</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const columns = ${columnsJson};
        let selectedFilePath = '';

        const fileFormatSelect = document.getElementById('fileFormat');
        const filePathInput = document.getElementById('filePath');
        const browseBtn = document.getElementById('browseBtn');
        const previewBtn = document.getElementById('previewBtn');
        const importBtn = document.getElementById('importBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const csvOptions = document.getElementById('csvOptions');

        fileFormatSelect.addEventListener('change', () => {
            csvOptions.style.display = fileFormatSelect.value === 'csv' ? 'block' : 'none';
        });

        browseBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'selectFile' });
        });

        previewBtn.addEventListener('click', () => {
            vscode.postMessage({
                command: 'previewFile',
                filePath: selectedFilePath,
                fileFormat: fileFormatSelect.value,
                delimiter: document.getElementById('delimiter').value
            });
        });

        importBtn.addEventListener('click', () => {
            const options = {
                schema: '${schema}',
                tableName: '${tableName}',
                fileFormat: fileFormatSelect.value,
                filePath: selectedFilePath,
                skipFirstRow: document.getElementById('skipFirstRow').checked,
                delimiter: document.getElementById('delimiter').value,
                quoteChar: document.getElementById('quoteChar').value,
                nullValue: document.getElementById('nullValue').value,
                truncateBeforeImport: document.getElementById('truncateFirst').checked
            };

            document.getElementById('progressContainer').style.display = 'block';
            importBtn.disabled = true;
            
            vscode.postMessage({
                command: 'import',
                options: options
            });
        });

        cancelBtn.addEventListener('click', () => {
            window.close();
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'fileSelected':
                    selectedFilePath = message.filePath;
                    filePathInput.value = message.filePath;
                    previewBtn.disabled = false;
                    importBtn.disabled = false;
                    break;
                    
                case 'previewData':
                    displayPreview(message.preview);
                    break;
                    
                case 'progress':
                    updateProgress(message.current, message.total);
                    break;
                    
                case 'error':
                    showError(message.error);
                    document.getElementById('progressContainer').style.display = 'none';
                    importBtn.disabled = false;
                    break;
            }
        });

        function displayPreview(preview) {
            const container = document.getElementById('previewContainer');
            
            if (preview.type === 'csv') {
                let html = '<div class="preview-box"><table class="preview-table"><thead><tr>';
                preview.rows[0].forEach(cell => {
                    html += \`<th>\${cell}</th>\`;
                });
                html += '</tr></thead><tbody>';
                for (let i = 1; i < preview.rows.length; i++) {
                    html += '<tr>';
                    preview.rows[i].forEach(cell => {
                        html += \`<td>\${cell}</td>\`;
                    });
                    html += '</tr>';
                }
                html += '</tbody></table></div>';
                container.innerHTML = html;
            } else if (preview.type === 'json') {
                const html = '<div class="preview-box"><pre>' + JSON.stringify(preview.items, null, 2) + '</pre></div>';
                container.innerHTML = html;
            }
        }

        function updateProgress(current, total) {
            const percent = Math.round((current / total) * 100);
            document.getElementById('progressFill').style.width = percent + '%';
            document.getElementById('progressText').textContent = \`\${current} / \${total} rows (\${percent}%)\`;
        }

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
        }
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for export panel
     */
    private static getExportHtml(schema: string, tableName: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Export Data</title>
    ${getStyles()}
    <style>
        /* Consistent form field spacing */
        .section-box .checkbox-group {
            margin-bottom: 16px;
        }
        .section-box .info-text:last-child {
            margin-bottom: 0;
        }
        #csvOptions {
            margin-bottom: 16px;
        }
        #csvOptions .form-group:last-child {
            margin-bottom: 0;
        }
        
        .file-input {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .file-input input {
            flex: 1;
        }
        textarea {
            resize: vertical;
            font-family: var(--vscode-editor-font-family, monospace);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Export Data from ${schema}.${tableName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <h2 style="font-size: 14px; margin: 0 0 16px 0; font-weight: 600;">Select Destination</h2>
            
            <div class="form-group">
                <label>File Format</label>
                <select id="fileFormat">
                    <option value="csv">CSV (Comma Separated Values)</option>
                    <option value="json">JSON (JavaScript Object Notation)</option>
                    <option value="sql">SQL (INSERT statements)</option>
                </select>
            </div>

            <div class="form-group">
                <label>File Path</label>
                <div class="file-input">
                    <input type="text" id="filePath" readonly placeholder="Click Browse to select destination" />
                    <button class="btn btn-secondary" id="browseBtn">Browse...</button>
                </div>
            </div>
        </div>

        <div class="section-box">
            <h2 style="font-size: 14px; margin: 0 0 16px 0; font-weight: 600;">Export Options</h2>
            
            <div id="csvOptions">
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" id="includeHeaders" checked />
                        <label for="includeHeaders" style="margin: 0;">Include column headers</label>
                    </div>
                </div>

                <div class="form-group">
                    <label>Delimiter</label>
                    <select id="delimiter">
                        <option value=",">Comma (,)</option>
                        <option value=";">Semicolon (;)</option>
                        <option value="\t">Tab</option>
                        <option value="|">Pipe (|)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Quote Character</label>
                    <input type="text" id="quoteChar" value='"' maxlength="1" />
                </div>

                <div class="form-group">
                    <label>NULL Value Representation</label>
                    <input type="text" id="nullValue" value="NULL" />
                </div>
            </div>
        </div>

        <div class="section-box">
            <h2 style="font-size: 14px; margin: 0 0 16px 0; font-weight: 600;">Data Selection</h2>
            
            <div class="form-group">
                <label>Custom SQL Query</label>
                <textarea id="customQuery" placeholder="SELECT * FROM ${schema}.${tableName} WHERE ..."></textarea>
                <div class="info-text">Leave empty to export all rows</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="exportBtn" disabled>Export Data</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let selectedFilePath = '';

        const fileFormatSelect = document.getElementById('fileFormat');
        const filePathInput = document.getElementById('filePath');
        const browseBtn = document.getElementById('browseBtn');
        const exportBtn = document.getElementById('exportBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const csvOptions = document.getElementById('csvOptions');

        fileFormatSelect.addEventListener('change', () => {
            csvOptions.style.display = fileFormatSelect.value === 'csv' ? 'block' : 'none';
            // Update file extension suggestion
            if (selectedFilePath) {
                const ext = '.' + fileFormatSelect.value;
                const newPath = selectedFilePath.replace(/\.[^.]+$/, ext);
                filePathInput.value = newPath;
                selectedFilePath = newPath;
            }
        });

        browseBtn.addEventListener('click', () => {
            vscode.postMessage({
                command: 'selectFile',
                format: fileFormatSelect.value
            });
        });

        exportBtn.addEventListener('click', () => {
            const options = {
                schema: '${schema}',
                tableName: '${tableName}',
                fileFormat: fileFormatSelect.value,
                filePath: selectedFilePath,
                includeHeaders: document.getElementById('includeHeaders').checked,
                delimiter: document.getElementById('delimiter').value,
                quoteChar: document.getElementById('quoteChar').value,
                nullValue: document.getElementById('nullValue').value,
                sqlQuery: document.getElementById('customQuery').value.trim() || null
            };

            exportBtn.disabled = true;
            exportBtn.textContent = 'Exporting...';
            
            vscode.postMessage({
                command: 'export',
                options: options
            });
        });

        cancelBtn.addEventListener('click', () => {
            window.close();
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'fileSelected':
                    selectedFilePath = message.filePath;
                    filePathInput.value = message.filePath;
                    exportBtn.disabled = false;
                    break;
                    
                case 'error':
                    showError(message.error);
                    exportBtn.disabled = false;
                    exportBtn.textContent = 'Export Data';
                    break;
            }
        });

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
        }
    </script>
</body>
</html>`;
    }
}


