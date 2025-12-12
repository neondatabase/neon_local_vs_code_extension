import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';

export interface IndexDefinition {
    indexName: string;
    tableName: string;
    schema: string;
    columns: string[];
    indexType: string;
    unique: boolean;
    concurrent: boolean;
    whereClause?: string;
}

export class IndexManagementPanel {
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
     * Create a new index on a table
     */
    public static async createIndex(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `create_${database || 'default'}.${schema}.${tableName}`;
        
        // If we already have a panel for this, show it
        if (IndexManagementPanel.currentPanels.has(key)) {
            IndexManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createIndex',
            `Create Index on ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        IndexManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            IndexManagementPanel.currentPanels.delete(key);
        });

        try {
            // Load table columns
            const schemaService = new SchemaService(stateService, context);
            const columns = await schemaService.getColumns(database || 'neondb', schema, tableName);
            
            const initialData = {
                schema,
                tableName,
                columns: columns.map(col => col.name)
            };

            panel.webview.html = IndexManagementPanel.getWebviewContent(context, panel, initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createIndex':
                        await IndexManagementPanel.executeCreateIndex(
                            context,
                            stateService,
                            message.indexDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = IndexManagementPanel.generateCreateIndexSql(message.indexDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load table columns: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Edit an existing index
     */
    public static async editIndex(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        indexName: string,
        database?: string
    ): Promise<void> {
        try {
            // Fetch current index details
            const sqlService = new SqlQueryService(stateService, context);
            const result = await sqlService.executeQuery(`
                SELECT
                    i.indexname as index_name,
                    i.tablename as table_name,
                    idx.indisunique as is_unique,
                    pg_get_indexdef(idx.indexrelid) as index_definition
                FROM pg_indexes i
                JOIN pg_class c ON c.relname = i.indexname
                JOIN pg_index idx ON idx.indexrelid = c.oid
                WHERE i.schemaname = $1 AND i.indexname = $2
            `, [schema, indexName], database);

            if (result.rows.length === 0) {
                vscode.window.showErrorMessage(`Index "${indexName}" not found`);
                return;
            }

            const indexInfo = result.rows[0];
            
            vscode.window.showInformationMessage(
                `Index editing requires dropping and recreating the index. Would you like to view the index definition?`,
                'View Definition',
                'Drop & Recreate',
                'Cancel'
            ).then(async (choice) => {
                if (choice === 'View Definition') {
                    const doc = await vscode.workspace.openTextDocument({
                        content: indexInfo.index_definition,
                        language: 'sql'
                    });
                    await vscode.window.showTextDocument(doc);
                } else if (choice === 'Drop & Recreate') {
                    // Guide user to drop and recreate
                    const shouldDrop = await vscode.window.showWarningMessage(
                        `To modify an index, you must drop and recreate it. Drop "${indexName}" now?`,
                        { modal: true },
                        'Drop Index'
                    );
                    
                    if (shouldDrop) {
                        await IndexManagementPanel.dropIndex(context, stateService, schema, indexName, false, database);
                        // Open create index panel
                        await IndexManagementPanel.createIndex(context, stateService, schema, indexInfo.table_name, database);
                    }
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load index details: ${errorMessage}`);
        }
    }

    /**
     * Drop an index
     */
    public static async dropIndex(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        indexName: string,
        concurrent: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const concurrentStr = concurrent ? 'CONCURRENTLY ' : '';
            const sql = `DROP INDEX ${concurrentStr}"${schema}"."${indexName}";`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Index "${indexName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to drop index: ${errorMessage}`);
        }
    }

    /**
     * Reindex a single index
     */
    public static async reindexIndex(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        indexName: string,
        database?: string
    ): Promise<void> {
        try {
            const sql = `REINDEX INDEX "${schema}"."${indexName}";`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Index "${indexName}" rebuilt successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to rebuild index: ${errorMessage}`);
        }
    }

    /**
     * View and manage indexes for a table
     */
    public static async manageIndexes(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `manage_${database || 'default'}.${schema}.${tableName}`;
        
        if (IndexManagementPanel.currentPanels.has(key)) {
            IndexManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'manageIndexes',
            `Manage Indexes: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        IndexManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            IndexManagementPanel.currentPanels.delete(key);
        });

        try {
            const schemaService = new SchemaService(stateService, context);
            const indexes = await schemaService.getIndexes(database || 'neondb', schema, tableName);
            
            panel.webview.html = IndexManagementPanel.getManageIndexesHtml(
                schema,
                tableName,
                indexes
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'dropIndex':
                        await IndexManagementPanel.dropIndex(
                            context,
                            stateService,
                            schema,
                            message.indexName,
                            message.concurrent,
                            database
                        );
                        panel.dispose();
                        break;
                    case 'reindex':
                        await IndexManagementPanel.reindexTable(
                            context,
                            stateService,
                            schema,
                            tableName,
                            message.concurrent,
                            database
                        );
                        break;
                    case 'refresh':
                        const refreshedIndexes = await schemaService.getIndexes(
                            database || 'neondb',
                            schema,
                            tableName
                        );
                        panel.webview.postMessage({
                            command: 'updateIndexes',
                            indexes: refreshedIndexes
                        });
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load indexes: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Reindex a table
     */
    private static async reindexTable(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        concurrent: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const concurrentStr = concurrent ? 'CONCURRENTLY ' : '';
            const sql = `REINDEX ${concurrentStr}TABLE "${schema}"."${tableName}";`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Table "${schema}.${tableName}" reindexed successfully!`);
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to reindex table: ${errorMessage}`);
        }
    }

    /**
     * Execute create index
     */
    private static async executeCreateIndex(
        context: vscode.ExtensionContext,
        stateService: StateService,
        indexDef: IndexDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = IndexManagementPanel.generateCreateIndexSql(indexDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Index "${indexDef.indexName}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Generate CREATE INDEX SQL
     */
    private static generateCreateIndexSql(indexDef: IndexDefinition): string {
        const {
            indexName,
            tableName,
            schema,
            columns,
            indexType,
            unique,
            concurrent,
            whereClause
        } = indexDef;

        let sql = 'CREATE';
        
        if (unique) {
            sql += ' UNIQUE';
        }
        
        sql += ' INDEX';
        
        if (concurrent) {
            sql += ' CONCURRENTLY';
        }
        
        sql += ` "${indexName}"`;
        sql += ` ON "${schema}"."${tableName}"`;
        
        if (indexType && indexType !== 'btree') {
            sql += ` USING ${indexType}`;
        }
        
        sql += ` (${columns.map(col => `"${col}"`).join(', ')})`;
        
        if (whereClause && whereClause.trim()) {
            sql += ` WHERE ${whereClause}`;
        }
        
        sql += ';';
        
        return sql;
    }

    /**

    /**
     * Get HTML for manage indexes panel
     */
    private static getManageIndexesHtml(
        schema: string,
        tableName: string,
        indexes: any[]
    ): string {
        const indexesJson = JSON.stringify(indexes);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Manage Indexes</title>
    ${getStyles()}
    <style>
        .container {
            max-width: 1200px;
        }
        .toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
        }
        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background-color: var(--vscode-editor-background);
        }
        th, td {
            text-align: left;
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
        }
        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }
        .badge-primary {
            background-color: var(--vscode-charts-blue);
            color: white;
        }
        .badge-unique {
            background-color: var(--vscode-charts-purple);
            color: white;
        }
        .badge-normal {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .no-indexes {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Manage Indexes: ${schema}.${tableName}</h1>
        
        <div class="info-text" style="margin-bottom: 16px;">
            Indexes improve query performance but require storage space and slow down writes. 
            Drop unused indexes to improve write performance.
        </div>

        <div class="toolbar">
            <button class="btn btn-secondary" id="refreshBtn">Refresh</button>
            <button class="btn" id="reindexBtn">Reindex Table</button>
            <button class="btn btn-secondary" id="closeBtn">Close</button>
        </div>

        <div id="indexTable">
            <!-- Will be populated by JavaScript -->
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let indexes = ${indexesJson};

        function renderIndexes() {
            const container = document.getElementById('indexTable');
            
            if (indexes.length === 0) {
                container.innerHTML = '<div class="no-indexes">No indexes found for this table.</div>';
                return;
            }

            let html = '<table><thead><tr>';
            html += '<th>Index Name</th>';
            html += '<th>Type</th>';
            html += '<th>Columns</th>';
            html += '<th>Actions</th>';
            html += '</tr></thead><tbody>';

            indexes.forEach(idx => {
                const isPrimary = idx.metadata?.is_primary;
                const isUnique = idx.metadata?.is_unique;
                
                html += '<tr>';
                html += \`<td><code>\${idx.name}</code></td>\`;
                html += '<td>';
                if (isPrimary) {
                    html += '<span class="badge badge-primary">PRIMARY</span>';
                } else if (isUnique) {
                    html += '<span class="badge badge-unique">UNIQUE</span>';
                } else {
                    html += '<span class="badge badge-normal">INDEX</span>';
                }
                html += '</td>';
                html += \`<td style="max-width: 300px; word-wrap: break-word;">\${idx.metadata?.definition || 'N/A'}</td>\`;
                html += '<td>';
                if (!isPrimary) {
                    html += \`<button class="btn btn-danger" onclick="dropIndex('\${idx.name}')">Drop</button>\`;
                } else {
                    html += '<span style="color: var(--vscode-descriptionForeground); font-size: 12px;">Cannot drop PRIMARY KEY</span>';
                }
                html += '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        }

        window.dropIndex = async function(indexName) {
            // Note: Actual confirmation will be handled by VS Code API
            vscode.postMessage({
                command: 'dropIndex',
                indexName: indexName,
                concurrent: false
            });
        };

        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        document.getElementById('reindexBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'reindex',
                concurrent: false
            });
        });

        document.getElementById('closeBtn').addEventListener('click', () => {
            window.close();
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'updateIndexes') {
                indexes = message.indexes;
                renderIndexes();
            }
        });

        renderIndexes();
    </script>
</body>
</html>`;
    }

    /**
     * Get webview content for React components
     */
    private static getWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'createIndex.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Index</title>
    <style>
        body { 
            margin: 0; 
            padding: 0; 
            height: 100vh; 
            overflow: auto; 
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
