import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';
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
    targetSchema?: string;
    targetTable?: string;
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
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        DataImportExportPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            DataImportExportPanel.currentPanels.delete(key);
        });

        try {
            // Get table columns
            const schemaService = new SchemaService(stateService, context);
            const columns = await schemaService.getColumns(database || 'neondb', schema, tableName);
            
            const initialData = {
                schema,
                tableName,
                columns: columns.map(col => ({ name: col.name, type: col.data_type }))
            };
            
            panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Import Data</title>
</head>
<body>
    <div id="root"></div>
    <script>
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'importData.js'))}"></script>
</body>
</html>`;

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'selectFile':
                        const format = message.fileFormat || 'csv';
                        
                        // Create filters based on selected format
                        const filters: { [key: string]: string[] } = {};
                        if (format === 'csv') {
                            filters['CSV Files'] = ['csv'];
                        } else if (format === 'json') {
                            filters['JSON Files'] = ['json'];
                        }
                        filters['All Files'] = ['*'];
                        
                        const fileUri = await vscode.window.showOpenDialog({
                            canSelectMany: false,
                            filters: filters,
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
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        DataImportExportPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            DataImportExportPanel.currentPanels.delete(key);
        });

        try {
            const initialData = {
                schema,
                tableName
            };
            
            panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Export Data</title>
</head>
<body>
    <div id="root"></div>
    <script>
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'exportData.js'))}"></script>
</body>
</html>`;

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'selectFile':
                        const defaultFileName = message.defaultFileName || `${tableName}.csv`;
                        const format = message.fileFormat || 'csv';
                        
                        // Create filters based on selected format
                        const filters: { [key: string]: string[] } = {};
                        if (format === 'csv') {
                            filters['CSV Files'] = ['csv'];
                        } else if (format === 'json') {
                            filters['JSON Files'] = ['json'];
                        } else if (format === 'sql') {
                            filters['SQL Files'] = ['sql'];
                        }
                        filters['All Files'] = ['*'];
                        
                        const fileUri = await vscode.window.showSaveDialog({
                            defaultUri: vscode.Uri.file(defaultFileName),
                            filters,
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
            
            if (fileFormat === 'csv') {
                const lines = content.split('\n').slice(0, 11).filter(line => line.trim()); // Preview first 10 rows + header
                if (lines.length === 0) {
                    throw new Error('File is empty');
                }
                
                const rows = lines.map(line => {
                    return this.parseCSVLine(line, delimiter);
                });
                
                // First row is columns
                const columns = rows[0];
                const data = rows.slice(1).map(row => {
                    const obj: any = {};
                    columns.forEach((col, idx) => {
                        obj[col] = row[idx] || '';
                    });
                    return obj;
                });
                
                panel.webview.postMessage({
                    command: 'previewData',
                    columns,
                    data
                });
                
            } else if (fileFormat === 'json') {
                const jsonData = JSON.parse(content);
                const items = Array.isArray(jsonData) ? jsonData.slice(0, 10) : [jsonData];
                
                if (items.length === 0) {
                    throw new Error('No data found in JSON file');
                }
                
                // Extract columns from first object
                const columns = Object.keys(items[0]);
                
                panel.webview.postMessage({
                    command: 'previewData',
                    columns,
                    data: items
                });
            }
            
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
            
            // Send initial progress
            panel.webview.postMessage({
                command: 'exportProgress',
                progress: 10,
                text: 'Executing query...'
            });
            
            // Build query
            const query = options.sqlQuery || `SELECT * FROM ${options.schema}.${options.tableName}`;
            
            // Execute query
            const result = await sqlService.executeQuery(query, database);
            
            panel.webview.postMessage({
                command: 'exportProgress',
                progress: 50,
                text: `Formatting ${result.rows.length} rows...`
            });
            
            // Check if we have data
            if (!result.columns || result.columns.length === 0) {
                throw new Error('No columns found in query result');
            }
            
            if (!result.rows || result.rows.length === 0) {
                throw new Error('No data to export');
            }
            
            let content = '';
            
            if (options.fileFormat === 'csv') {
                // Export as CSV
                const headers = result.columns;
                
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
                const headers = result.columns;
                const targetSchema = options.targetSchema || options.schema;
                const targetTable = options.targetTable || options.tableName || 'exported_data';
                
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
                    content += `INSERT INTO ${targetSchema}.${targetTable} (${headers.join(', ')}) VALUES (${values.join(', ')});\n`;
                }
            }
            
            // Write to file
            panel.webview.postMessage({
                command: 'exportProgress',
                progress: 90,
                text: 'Writing to file...'
            });
            
            fs.writeFileSync(options.filePath, content, 'utf-8');
            
            vscode.window.showInformationMessage(`Successfully exported ${result.rows.length} rows to ${path.basename(options.filePath)}`);
            
            panel.webview.postMessage({
                command: 'exportComplete',
                filePath: options.filePath
            });
            
            // Dispose panel after a short delay to allow user to see the success message
            setTimeout(() => {
                panel.dispose();
            }, 1000);
            
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
}
