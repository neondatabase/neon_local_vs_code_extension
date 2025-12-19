import * as vscode from 'vscode';
import * as os from 'os';
import { SqlQueryService, QueryResult, QueryError } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';

export class SqlQueryPanel {
    public static currentPanel: SqlQueryPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        initialQuery?: string,
        database?: string
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Always create a new panel
        const panel = vscode.window.createWebviewPanel(
            'sqlQuery',
            database ? `SQL Editor - ${database}` : 'SQL Editor',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        SqlQueryPanel.currentPanel = new SqlQueryPanel(panel, context, stateService, initialQuery, database);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        initialQuery?: string,
        private database?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getWebviewContent(this.panel.webview);

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        // Send initial data
        setTimeout(() => {
            this.sendMessage({
                command: 'initialize',
                query: initialQuery || '',
                database: this.database
            });
        }, 100);
    }

    private async handleMessage(message: any) {
        const sqlService = new SqlQueryService(this.stateService, this.context);
        
        switch (message.command) {
            case 'executeQuery':
                try {
                    const result = await sqlService.executeQuery(message.query, this.database);
                    this.sendMessage({
                        command: 'queryResult',
                        result,
                        success: true
                    });
                } catch (error) {
                    this.sendMessage({
                        command: 'queryResult',
                        error: error as QueryError,
                        success: false
                    });
                }
                break;

            case 'validateQuery':
                const validation = sqlService.validateSql(message.query);
                this.sendMessage({
                    command: 'validationResult',
                    validation
                });
                break;

            case 'showExportDialog':
                await this.showExportDialog(message.data);
                break;

            case 'exportResults':
                await this.exportResults(message.data, message.format);
                break;

            case 'openNeonConsole':
                try {
                    await this.openNeonConsole();
                } catch (error) {
                    this.sendMessage({
                        command: 'error',
                        error: error instanceof Error ? error.message : 'Failed to open Neon console'
                    });
                }
                break;

            case 'getSchemaForAutocomplete':
                try {
                    const schemaInfo = await this.getSchemaForAutocomplete();
                    this.sendMessage({
                        command: 'schemaForAutocomplete',
                        schemaInfo,
                        success: true
                    });
                } catch (error) {
                    console.error('Failed to get schema for autocomplete:', error);
                    this.sendMessage({
                        command: 'schemaForAutocomplete',
                        error: error instanceof Error ? error.message : 'Failed to get schema',
                        success: false
                    });
                }
                break;
                
        }
    }

    private sendMessage(message: any) {
        this.panel.webview.postMessage(message);
    }

    private async getSchemaForAutocomplete(): Promise<any> {
        try {
            // Get the current state to access schema information
            const viewData = await this.stateService.getViewData();
            
            if (!viewData.connection.connected) {
                throw new Error('Not connected to database');
            }

            // Create a simple schema structure for autocomplete
            const schemaInfo = {
                tables: [] as any[],
                columns: [] as any[]
            };

            // Get database schema using the schema service
            const schemaService = new (require('../services/schema.service').SchemaService)(
                this.stateService, 
                new (require('../services/api.service').NeonApiService)(this.context)
            );

            // Get tables and their columns
            const databases = await schemaService.getDatabases();
            if (databases && databases.length > 0) {
                for (const database of databases) {
                    // Get tables for this database
                    const tablesResult = await schemaService.getTables(database.name, 'public');
                    if (tablesResult && tablesResult.length > 0) {
                        for (const table of tablesResult) {
                            schemaInfo.tables.push({
                                name: table.name,
                                schema: 'public',
                                database: database.name
                            });

                            // Get columns for this table
                            try {
                                const columnsResult = await schemaService.getColumns(database.name, 'public', table.name);
                                if (columnsResult && columnsResult.length > 0) {
                                    for (const column of columnsResult) {
                                        schemaInfo.columns.push({
                                            name: column.column_name,
                                            type: column.data_type,
                                            table: table.name,
                                            schema: 'public',
                                            database: database.name
                                        });
                                    }
                                }
                            } catch (columnError) {
                                console.warn(`Failed to get columns for table ${table.name}:`, columnError);
                            }
                        }
                    }
                }
            }

            console.log('Schema info for autocomplete:', schemaInfo);
            return schemaInfo;

        } catch (error) {
            console.error('Error getting schema for autocomplete:', error);
            throw error;
        }
    }

    public setQuery(query: string) {
        this.sendMessage({
            command: 'setQuery',
            query
        });
    }

    private async openNeonConsole(): Promise<void> {
        try {
            // Get the current project and branch IDs
            const viewData = await this.stateService.getViewData();
            const projectId = viewData.connection?.selectedProjectId;
            const branchId = viewData.connectionType === 'new' ? 
                viewData.currentlyConnectedBranch : 
                viewData.connection?.selectedBranchId;
            
            if (!projectId || !branchId) {
                throw new Error('Project ID or Branch ID not found');
            }

            // Get available databases
            const databases = await this.stateService.getDatabases();
            if (!databases || databases.length === 0) {
                throw new Error('No databases available');
            }

            // Use the current database context or default to the first available database
            let selectedDatabase = this.database;
            if (!selectedDatabase && databases.length > 0) {
                selectedDatabase = databases[0].name;
            }

            // Open the SQL Editor URL in the browser
            const sqlEditorUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/sql-editor?database=${selectedDatabase}`;
            await vscode.env.openExternal(vscode.Uri.parse(sqlEditorUrl));
        } catch (error) {
            console.error('Error opening Neon console:', error);
            throw error;
        }
    }

    private async showExportDialog(data: any[]) {
        // Show quick pick for format selection
        const format = await vscode.window.showQuickPick(
            [
                { label: 'CSV', value: 'csv', description: 'Comma-separated values' },
                { label: 'JSON', value: 'json', description: 'JavaScript Object Notation' }
            ],
            {
                placeHolder: 'Select export format',
                title: 'Export Results'
            }
        );

        if (format) {
            await this.exportResults(data, format.value as 'csv' | 'json');
        }
    }

    private async exportResults(data: any[], format: 'csv' | 'json') {
        try {
            // Use workspace folder as default, or user's home directory if no workspace
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
            const defaultDir = workspaceFolder || vscode.Uri.file(os.homedir());
            const defaultUri = vscode.Uri.joinPath(defaultDir, `results.${format}`);

            const uri = await vscode.window.showSaveDialog({
                defaultUri: defaultUri,
                filters: format === 'csv' 
                    ? { 'CSV Files': ['csv'], 'All Files': ['*'] }
                    : { 'JSON Files': ['json'], 'All Files': ['*'] }
            });

            if (uri) {
                let content: string;
                if (format === 'csv') {
                    // Convert to CSV
                    if (data.length === 0) {
                        content = '';
                    } else {
                        const headers = Object.keys(data[0]).join(',');
                        const rows = data.map(row => 
                            Object.values(row).map(value => 
                                typeof value === 'string' && value.includes(',') 
                                    ? `"${value.replace(/"/g, '""')}"` 
                                    : String(value)
                            ).join(',')
                        );
                        content = [headers, ...rows].join('\n');
                    }
                } else {
                    // Convert to JSON
                    content = JSON.stringify(data, null, 2);
                }

                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                vscode.window.showInformationMessage(`Results exported to ${uri.fsPath}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export results: ${error}`);
        }
    }

    private getWebviewContent(webview: vscode.Webview): string {
        // Note: We use inline styles instead of external CSS files

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SQL Editor</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .main-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        .query-section {
            display: flex;
            flex-direction: column;
            min-height: 120px;
            max-height: 80vh;
            transition: all 0.3s ease-in-out;
        }

        .query-section.collapsed {
            min-height: 0;
            max-height: 0;
            overflow: hidden;
        }

        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background-color: var(--vscode-toolbar-activeBackground, var(--vscode-tab-activeBackground));
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .toolbar-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toolbar button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }

        .toolbar button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .toolbar button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .secondary-btn {
            background-color: var(--vscode-button-secondaryBackground) !important;
            color: var(--vscode-button-secondaryForeground) !important;
        }

        .secondary-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground) !important;
        }

        .icon-buttons {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .control-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .control-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .control-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .database-indicator {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            background-color: var(--vscode-toolbar-activeBackground, var(--vscode-tab-activeBackground));
            color: var(--vscode-badge-foreground);
            border: 1px solid var(--vscode-badge-background);
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            margin-right: 8px;
            white-space: nowrap;
            min-width: 0;
        }

        .database-indicator:empty {
            display: none;
        }

        .database-indicator .db-icon {
            width: 12px;
            height: 12px;
            margin-right: 4px;
            flex-shrink: 0;
        }

        .database-indicator .db-icon svg {
            width: 100%;
            height: 100%;
            color: var(--vscode-badge-foreground);
        }

        .query-editor {
            flex: 1;
            min-height: 200px;
            display: flex;
            flex-direction: column;
        }
        
        .embedded-editor {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .embedded-editor .cm-editor {
            height: 100%;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        
        .embedded-editor .cm-focused {
            outline: none;
        }

        .results-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 200px;
            max-height: calc(100vh - 40px);
            overflow: hidden;
        }

        .results-section.maximized {
            max-height: calc(100vh - 60px);
        }

        .tab-container {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-titleBar-activeBackground);
        }

        .tab-group {
            display: flex;
            flex: 1;
        }

        .tab {
            padding: 8px 16px;
            cursor: pointer;
            border-right: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
            user-select: none;
        }

        .tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }

        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
            border-bottom: 2px solid var(--vscode-focusBorder);
        }

        .tab-content {
            flex: 1;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }

        .tab-content.active {
            display: flex;
            overflow: hidden;
        }

        .results-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background-color: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
        }

        .results-title-section {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .results-controls {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-controls {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 4px 8px;
            font-size: 12px;
            width: 200px;
        }

        .filter-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .sortable-header {
            cursor: pointer;
            user-select: none;
            position: relative;
        }

        .sortable-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .sort-indicator {
            position: absolute;
            right: 4px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 10px;
            opacity: 0.7;
        }

        .column-visibility-dropdown {
            position: absolute;
            top: 100%;
            right: 0;
            background-color: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            padding: 8px;
            z-index: 1000;
            min-width: 200px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .column-visibility-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px;
            cursor: pointer;
        }

        .column-visibility-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .column-visibility-item input[type="checkbox"] {
            margin: 0;
        }

        .hidden-column {
            display: none;
        }

        .results-table {
            flex: 1;
            overflow: auto;
            background-color: var(--vscode-editor-background);
            min-height: 0;
        }

        table {
            width: 100%;
            min-width: max-content;
            border-collapse: collapse;
            font-size: 13px;
        }

        th, td {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 120px;
            max-width: 400px;
        }

        /* Allow specific columns to be wider if needed */
        th.wide-column, td.wide-column {
            max-width: 600px;
        }

        /* Handle very long content gracefully */
        th:hover {
            overflow: visible;
            white-space: normal;
            word-break: break-word;
            position: relative;
            z-index: 100;
            background-color: var(--vscode-editor-background);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        th {
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1;
            opacity: 1;
            backdrop-filter: blur(0px);
        }

        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .status-bar {
            padding: 4px 16px;
            background-color: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            font-size: 12px;
            border-top: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
        }

        .error {
            color: var(--vscode-errorForeground);
            padding: 16px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            margin: 16px;
            border-radius: 3px;
            white-space: pre-wrap;
        }

        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
            font-style: italic;
        }

        .no-results {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
            color: var(--vscode-descriptionForeground);
        }

        .splitter {
            height: 4px;
            background-color: var(--vscode-panel-border);
            cursor: row-resize;
            flex-shrink: 0;
            transition: background-color 0.2s ease;
            position: relative;
        }

        .splitter:hover {
            background-color: var(--vscode-focusBorder);
            height: 6px;
        }

        .splitter.hidden {
            display: none;
        }

        .expand-button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 8px;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            min-width: 32px;
            height: 32px;
            margin-right: 8px;
        }

        .expand-button:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        .expand-button:active {
            background-color: var(--vscode-toolbar-activeBackground);
        }

        .performance-stats {
            padding: 16px;
            font-family: var(--vscode-editor-font-family);
            overflow: auto;
            flex: 1;
            min-height: 0;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
            min-width: max-content;
        }

        .stats-card {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 12px;
        }

        .stats-card h3 {
            margin: 0 0 8px 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .stats-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .stats-list li {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 13px;
        }

        .stats-list li:last-child {
            border-bottom: none;
        }

        .stats-label {
            color: var(--vscode-descriptionForeground);
        }

        .stats-value {
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        .complexity-simple {
            color: var(--vscode-charts-green);
        }

        .complexity-moderate {
            color: var(--vscode-charts-orange);
        }

        .complexity-complex {
            color: var(--vscode-charts-red);
        }

        .scan-type {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 4px;
        }

        .scan-index {
            background-color: var(--vscode-charts-green);
            color: var(--vscode-editor-background);
        }

        .scan-bitmap {
            background-color: var(--vscode-charts-orange);
            color: var(--vscode-editor-background);
        }

        .scan-seq {
            background-color: var(--vscode-charts-red);
            color: var(--vscode-editor-background);
        }
    </style>
</head>
<body>
    <div class="main-container">
        <div class="query-section" id="querySection">
            <div class="toolbar">
                <div class="toolbar-left">
                    <button id="executeBtn">Run Query</button>
                    <span id="databaseIndicator" class="database-indicator" title="Current database"></span>
                    <span id="statusText"></span>
                </div>
                <div class="toolbar-right">
                    <div class="icon-buttons">
                        <button id="exportBtn" class="control-btn" disabled title="Export Results">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8 2v8M8 10L5 7M8 10l3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M3 12v1.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </button>
                        <button id="openNeonConsoleBtn" class="control-btn" title="Open in Neon console">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 2H14V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M14 2L8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                                <path d="M12 9V13C12 13.5523 11.5523 14 11 14H3C2.44772 14 2 13.5523 2 13V5C2 4.44772 2.44772 4 3 4H7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
            
            <div id="queryEditor" class="query-editor embedded-editor"></div>
        </div>
        
        <div class="splitter" id="splitter"></div>
        
        <div class="results-section" id="resultsSection">
            <div class="tab-container">
                <div class="tab-group">
                    <div class="tab active" id="resultsTab">Results</div>
                    <div class="tab" id="performanceTab">Performance</div>
                </div>
                <button class="expand-button" id="expandBtn" title="Expand to full page">
                    <span id="expandIcon">⛶</span>
                </button>
            </div>
            
            <div class="tab-content active" id="resultsContent">
                <div class="results-header">
                    <div class="results-title-section">
                        <span id="resultsTitle">Query Results</span>
                        <span id="resultsInfo"></span>
                    </div>
                    <div class="results-controls">
                        <div class="filter-controls">
                            <input type="text" id="filterInput" placeholder="Filter results..." class="filter-input" />
                            <button id="columnVisibilityBtn" class="control-btn" title="Show/Hide Columns">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M2 3h12v1H2V3zm0 3h12v1H2V6zm0 3h12v1H2V9zm0 3h12v1H2v-1z"/>
                                    <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11z" fill="none" stroke="currentColor" stroke-width="0.5"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="results-table" id="resultsContainer">
                    <div class="no-results">Execute a query to see results</div>
                </div>
            </div>
            
            <div class="tab-content" id="performanceContent">
                <div class="performance-stats" id="performanceStats">
                    <div class="no-results">Execute a query to see performance statistics</div>
                </div>
            </div>
        </div>
        
        <div class="status-bar" id="statusBar">
            Ready
        </div>
    </div>

    <!-- Load CodeMirror bundle via webview URI -->
    <script src="${webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'embeddedSqlEditor.js'))}"></script>
    <!-- Load SQL Parser for syntax validation -->
    <script>
        // Load SQL Parser with error handling
        const sqlParserScript = document.createElement('script');
        sqlParserScript.src = '${webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'node-sql-parser', 'umd', 'index.umd.js'))}';
        sqlParserScript.onload = function() {
            console.log('SQL Parser loaded successfully');
            console.log('Available parsers:', window.NodeSQLParser ? Object.keys(window.NodeSQLParser) : 'NodeSQLParser not found');
            
            // Test the parser
            if (window.NodeSQLParser) {
                try {
                    const { Parser } = window.NodeSQLParser;
                    const parser = new Parser();
                    console.log('SQL Parser initialized successfully');
                } catch (error) {
                    console.error('Failed to initialize SQL Parser:', error);
                }
            }
        };
        sqlParserScript.onerror = function(error) {
            console.error('Failed to load SQL Parser:', error);
            console.log('Will use basic SQL validation instead');
        };
        document.head.appendChild(sqlParserScript);
    </script>
    <script>
        const vscode = acquireVsCodeApi();
        
        let currentData = [];
        let filteredData = [];
        let originalColumns = [];
        let visibleColumns = [];
        let sortColumn = null;
        let sortDirection = 'asc';
        
        // Elements
        const queryEditorContainer = document.getElementById('queryEditor');
        const executeBtn = document.getElementById('executeBtn');
        
        // Initialize embedded SQL editor
        let sqlEditor = null;
        
        // Wait for CodeMirror to load, then initialize
        function initializeSqlEditor() {
            console.log('Attempting to initialize SQL editor...');
            console.log('window.SimpleSqlEditor:', window.SimpleSqlEditor);
            console.log('queryEditorContainer:', queryEditorContainer);
            
            if (window.SimpleSqlEditor && queryEditorContainer) {
                try {
                    sqlEditor = new window.SimpleSqlEditor(queryEditorContainer, vscode);
                    
                    // Set up execute callback
                    sqlEditor.onExecute((query) => {
                        executeQueryWithText(query);
                    });
                    
                    console.log('CodeMirror SQL Editor initialized successfully');
                    
                    // Try to load schema information for better autocomplete
                    if (window.loadSchemaForAutocomplete) {
                        window.loadSchemaForAutocomplete();
                    }
                    
                    return true; // Success
                } catch (error) {
                    console.error('Error initializing SQL editor:', error);
                    return false; // Failed
                }
            } else {
                console.log('SimpleSqlEditor not ready, retrying...');
                return false; // Not ready
            }
        }
        
        // Initialize when DOM is ready
        let initRetries = 0;
        const maxRetries = 50; // 5 seconds max
        
        function tryInitialize() {
            if (initializeSqlEditor()) {
                console.log('SQL Editor initialized successfully');
                return;
            }
            
            initRetries++;
            if (initRetries < maxRetries) {
                setTimeout(tryInitialize, 100);
            } else {
                console.error('Failed to initialize SQL Editor after maximum retries');
                // Fall back to a simple textarea
                if (queryEditorContainer) {
                    queryEditorContainer.innerHTML = '<textarea id="fallbackEditor" placeholder="-- Enter your SQL query here\\n-- Press Ctrl+Enter to execute" style="width: 100%; height: 300px; font-family: monospace; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 8px; resize: vertical;"></textarea>';
                    const fallbackEditor = document.getElementById('fallbackEditor');
                    if (fallbackEditor) {
                        sqlEditor = {
                            getValue: () => fallbackEditor.value,
                            setValue: (value) => { fallbackEditor.value = value; },
                            onExecute: () => {}, // Not implemented for fallback
                            insertText: (text) => { fallbackEditor.value += text; }
                        };
                    }
                }
            }
        }
        
        // Start initialization
        tryInitialize();
        
        // Function to load schema information for autocomplete
        function loadSchemaForAutocomplete() {
            console.log('Loading schema information for autocomplete...');
            
            // Request schema information from the extension
            vscode.postMessage({
                command: 'getSchemaForAutocomplete'
            });
        }
        
        // Expose the function so it can be called from the initialization
        window.loadSchemaForAutocomplete = loadSchemaForAutocomplete;
        const exportBtn = document.getElementById('exportBtn');
        const openNeonConsoleBtn = document.getElementById('openNeonConsoleBtn');
        const databaseIndicator = document.getElementById('databaseIndicator');
        const resultsContainer = document.getElementById('resultsContainer');
        const resultsInfo = document.getElementById('resultsInfo');
        const statusBar = document.getElementById('statusBar');
        const splitter = document.getElementById('splitter');
        const filterInput = document.getElementById('filterInput');
        const columnVisibilityBtn = document.getElementById('columnVisibilityBtn');
        
        // Layout elements
        const querySection = document.getElementById('querySection');
        const resultsSection = document.getElementById('resultsSection');
        const expandBtn = document.getElementById('expandBtn');
        const expandIcon = document.getElementById('expandIcon');
        
        // Tab elements
        const resultsTab = document.getElementById('resultsTab');
        const performanceTab = document.getElementById('performanceTab');
        const resultsContent = document.getElementById('resultsContent');
        const performanceContent = document.getElementById('performanceContent');
        const performanceStats = document.getElementById('performanceStats');
        
        // State
        let isExpanded = false;
        
        // Event listeners
        executeBtn.addEventListener('click', executeQuery);
        exportBtn.addEventListener('click', exportResults);
        openNeonConsoleBtn.addEventListener('click', openNeonConsole);
        expandBtn.addEventListener('click', toggleExpand);
        filterInput.addEventListener('input', applyFilter);
        columnVisibilityBtn.addEventListener('click', toggleColumnVisibility);
        
        // Tab switching
        resultsTab.addEventListener('click', () => switchTab('results'));
        performanceTab.addEventListener('click', () => switchTab('performance'));
        
        // CodeMirror handles keyboard shortcuts internally (Ctrl+Enter, F5, etc.)
        
        // Global keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Backquote') {
                e.preventDefault();
                toggleExpand();
            }
        });
        
        // Splitter functionality for resizing
        let isDragging = false;
        let startY = 0;
        let startQueryHeight = 0;
        
        splitter.addEventListener('mousedown', (e) => {
            if (isExpanded) return;
            isDragging = true;
            startY = e.clientY;
            startQueryHeight = querySection.offsetHeight;
            document.addEventListener('mousemove', handleSplitterDrag);
            document.addEventListener('mouseup', stopSplitterDrag);
            e.preventDefault();
        });
        
        function handleSplitterDrag(e) {
            if (!isDragging || isExpanded) return;
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(120, Math.min(window.innerHeight * 0.8, startQueryHeight + deltaY));
            querySection.style.height = newHeight + 'px';
            querySection.style.maxHeight = newHeight + 'px';
        }
        
        function stopSplitterDrag() {
            isDragging = false;
            document.removeEventListener('mousemove', handleSplitterDrag);
            document.removeEventListener('mouseup', stopSplitterDrag);
        }
        
        function toggleExpand() {
            isExpanded = !isExpanded;
            
            if (isExpanded) {
                querySection.classList.add('collapsed');
                resultsSection.classList.add('maximized');
                splitter.classList.add('hidden');
                expandIcon.textContent = '⛷';
                expandBtn.title = 'Collapse from full page';
            } else {
                querySection.classList.remove('collapsed');
                resultsSection.classList.remove('maximized');
                splitter.classList.remove('hidden');
                expandIcon.textContent = '⛶';
                expandBtn.title = 'Expand to full page';
                
                // Reset to default height when collapsing
                querySection.style.height = '';
                querySection.style.maxHeight = '';
            }
        }
        
        // Handle window resize
        window.addEventListener('resize', () => {
            if (!isExpanded && querySection.style.height) {
                const currentHeight = parseInt(querySection.style.height);
                const maxHeight = window.innerHeight * 0.8;
                if (currentHeight > maxHeight) {
                    querySection.style.height = maxHeight + 'px';
                    querySection.style.maxHeight = maxHeight + 'px';
                }
            }
        });
        
        // Message handling
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'initialize':
                    if (message.query) {
                        queryEditor.value = message.query;
                    }
                    if (message.database) {
                        databaseIndicator.innerHTML = 
                            '<span class="db-icon">' +
                                '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                                    '<path d="M13 4C13 2.5 10.3 1 8 1S3 2.5 3 4v8c0 1.5 2.7 3 5 3s5-1.5 5-3V4z" stroke="currentColor" stroke-width="1" fill="none"/>' +
                                    '<path d="M13 4c0 1.5-2.7 3-5 3S3 5.5 3 4" stroke="currentColor" stroke-width="1" fill="none"/>' +
                                    '<path d="M13 8c0 1.5-2.7 3-5 3S3 9.5 3 8" stroke="currentColor" stroke-width="1" fill="none"/>' +
                                '</svg>' +
                            '</span>' +
                            '<span>' + message.database + '</span>';
                        databaseIndicator.title = 'Current database: ' + message.database;
                    }
                    updateStatus('Ready');
                    break;
                    
                case 'setQuery':
                    queryEditor.value = message.query;
                    break;
                    
                case 'queryResult':
                    handleQueryResult(message);
                    break;
                    
                case 'validationResult':
                    handleValidationResult(message.validation);
                    break;
            }
        });
        
        function executeQuery() {
            const query = sqlEditor ? sqlEditor.getValue().trim() : '';
            if (!query) return;
            executeQueryWithText(query);
        }
        
        function executeQueryWithText(query) {
            console.log('🔍 executeQueryWithText() called with query:', query.substring(0, 100) + (query.length > 100 ? '...' : ''));
            
            if (!query) {
                console.log('🔍 Empty query, aborting');
                return;
            }
            
            // Validate SQL before execution using the SQL editor's validation
            console.log('🔍 Starting SQL validation...');
            if (sqlEditor && sqlEditor.validateSql) {
                const validation = sqlEditor.validateSql(query);
                console.log('🔍 Validation result:', validation);
                
                if (!validation.isValid) {
                    // Show validation errors and prevent execution
                    const errorMessage = \`SQL Validation Failed:\\n\\n\${validation.errors.join('\\n')}\`;
                    console.log('🔍 BLOCKING QUERY EXECUTION - Validation failed:', validation.errors);
                    
                    // Show errors in the editor with highlighting
                    if (sqlEditor && sqlEditor.showValidationErrors) {
                        console.log('🔍 Showing validation errors in editor');
                        sqlEditor.showValidationErrors(validation.errors, query);
                    }
                    
                    // Display error in results area with subtle styling
                    resultsContainer.innerHTML = \`
                        <div style="padding: 16px; background: var(--vscode-inputValidation-errorBackground, #5a1d1d); border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100); border-radius: 4px; margin: 10px; color: var(--vscode-inputValidation-errorForeground, #f8f8f2);">
                            <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                <span style="margin-right: 8px;">⚠️</span>
                                <h3 style="margin: 0; font-size: 14px; font-weight: 500;">SQL Validation Failed</h3>
                            </div>
                            <pre style="margin: 0; white-space: pre-wrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.4; opacity: 0.9;">\${errorMessage}</pre>
                        </div>
                    \`;
                    resultsInfo.textContent = 'Query blocked due to validation errors';
                    updateStatus('❌ Query validation failed', 'error');
                    setButtonsEnabled(true);
                    console.log('🔍 Query execution blocked');
                    return;
                }
            } else {
                console.log('🔍 ⚠️ SQL Editor validation not available, executing without validation');
            }
            
            console.log('🔍 ✅ Validation passed, executing query...');
            
            // Clear any previous validation errors in the editor
            if (sqlEditor && sqlEditor.clearValidationErrors) {
                sqlEditor.clearValidationErrors();
            }
            
            updateStatus('Executing query...');
            setButtonsEnabled(false);
            
            vscode.postMessage({
                command: 'executeQuery',
                query: query
            });
        }
        
        function openNeonConsole() {
            vscode.postMessage({
                command: 'openNeonConsole'
            });
        }
        
        
        function exportResults() {
            if (currentData.length === 0) return;
            
            // Send message to extension to show format selection dialog
            vscode.postMessage({
                command: 'showExportDialog',
                data: currentData
            });
        }
        
        function switchTab(tabName) {
            // Remove active class from all tabs and content
            resultsTab.classList.remove('active');
            performanceTab.classList.remove('active');
            resultsContent.classList.remove('active');
            performanceContent.classList.remove('active');
            
            // Add active class to selected tab and content
            if (tabName === 'results') {
                resultsTab.classList.add('active');
                resultsContent.classList.add('active');
            } else if (tabName === 'performance') {
                performanceTab.classList.add('active');
                performanceContent.classList.add('active');
            }
        }

        function handleQueryResult(message) {
            setButtonsEnabled(true);
            
            if (message.success) {
                const result = message.result;
                currentData = result.rows;
                originalColumns = result.columns;
                visibleColumns = [...result.columns];
                filteredData = [...result.rows];
                sortColumn = null;
                sortDirection = 'asc';
                filterInput.value = '';
                displayResults(result);
                displayPerformanceStats(result.performanceStats);
                updateStatus(\`Query executed in \${result.executionTime}ms - \${result.rowCount} rows\`);
                exportBtn.disabled = result.rowCount === 0;
                
                // Clear any error highlighting on successful execution
                if (window.sqlEditor && window.sqlEditor.clearErrorHighlight) {
                    window.sqlEditor.clearErrorHighlight();
                }
            } else {
                displayError(message.error);
                updateStatus('Query failed');
                exportBtn.disabled = true;
                // Clear performance stats on error
                performanceStats.innerHTML = '<div class="no-results">No performance data available</div>';
            }
        }
        
        function displayResults(result) {
            if (result.rowCount === 0) {
                resultsContainer.innerHTML = '<div class="no-results">No results</div>';
                resultsInfo.textContent = 'No rows';
                return;
            }
            
            displayTable();
        }
        
        function displayTable() {
            if (filteredData.length === 0) {
                resultsContainer.innerHTML = '<div class="no-results">No results match the filter</div>';
                resultsInfo.textContent = 'No matching rows';
                return;
            }
            
            const table = document.createElement('table');
            
            // Create header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            visibleColumns.forEach(col => {
                const th = document.createElement('th');
                th.textContent = col;
                th.title = col;
                th.className = 'sortable-header';
                th.style.position = 'relative';
                
                // Add sort indicator if this column is being sorted
                if (sortColumn === col) {
                    const sortIndicator = document.createElement('span');
                    sortIndicator.className = 'sort-indicator';
                    sortIndicator.textContent = sortDirection === 'asc' ? '↑' : '↓';
                    th.appendChild(sortIndicator);
                }
                
                // Add click handler for sorting
                th.addEventListener('click', () => sortBy(col));
                
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);
            table.appendChild(thead);
            
            // Create body
            const tbody = document.createElement('tbody');
            filteredData.forEach(row => {
                const tr = document.createElement('tr');
                visibleColumns.forEach(col => {
                    const td = document.createElement('td');
                    const value = row[col];
                    td.textContent = value === null ? 'NULL' : String(value);
                    td.title = td.textContent;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            
            resultsContainer.innerHTML = '';
            resultsContainer.appendChild(table);
            resultsInfo.textContent = \`\${filteredData.length} of \${currentData.length} rows\`;
        }
        
        function displayError(error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.style.cssText = \`
                padding: 12px 8px;
                background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
                border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
                border-radius: 3px;
                margin: 8px 0;
                color: var(--vscode-inputValidation-errorForeground, #f8f8f2);
                font-family: var(--vscode-editor-font-family, monospace);
                white-space: nowrap;
                min-height: auto;
                max-height: 48px;
                overflow: hidden;
                display: flex;
                align-items: center;
            \`;
            
            // Simple error message with just line number
            const lineNumber = error.line || 'Unknown';
            
            errorDiv.innerHTML = \`
                <span style="margin-right: 6px; font-size: 11px;">❌</span>
                <span style="font-weight: 500; font-size: 12px; margin-right: 8px;">SQL Syntax Error</span>
                <span style="font-size: 11px; color: var(--vscode-descriptionForeground); opacity: 0.9;">Line: \${lineNumber}</span>
            \`;
            
            // Show error banner in results area
            resultsContainer.innerHTML = '';
            resultsContainer.appendChild(errorDiv);
            resultsInfo.textContent = 'Error';
            
            // Highlight the error line in the SQL editor
            if (error.line && window.sqlEditor && window.sqlEditor.highlightErrorLine) {
                window.sqlEditor.highlightErrorLine(error.line);
            }
        }
        
        function setButtonsEnabled(enabled) {
            executeBtn.disabled = !enabled;
        }
        
        function updateStatus(text) {
            statusBar.textContent = text;
        }
        
        function displayPerformanceStats(stats) {
            if (!stats) {
                performanceStats.innerHTML = '<div class="no-results">No performance data available</div>';
                return;
            }
            
            const formatTime = (ms) => ms !== undefined ? \`\${ms.toFixed(2)}ms\` : 'N/A';
            const formatBytes = (bytes) => {
                if (!bytes) return 'N/A';
                if (bytes < 1024) return \`\${bytes} B\`;
                if (bytes < 1024 * 1024) return \`\${(bytes / 1024).toFixed(1)} KB\`;
                return \`\${(bytes / (1024 * 1024)).toFixed(1)} MB\`;
            };
            
            const getComplexityClass = (complexity) => {
                switch(complexity?.toLowerCase()) {
                    case 'simple': return 'complexity-simple';
                    case 'moderate': return 'complexity-moderate';
                    case 'complex': return 'complexity-complex';
                    default: return '';
                }
            };
            
            const getScanBadge = (scanType) => {
                switch(scanType) {
                    case 'index_scan': return '<span class="scan-type scan-index">INDEX</span>';
                    case 'bitmap_scan': return '<span class="scan-type scan-bitmap">BITMAP</span>';
                    case 'seq_scan': return '<span class="scan-type scan-seq">SEQ SCAN</span>';
                    default: return '';
                }
            };
            
            let indexesHtml = 'None';
            if (stats.indexesUsed && stats.indexesUsed.length > 0) {
                indexesHtml = stats.indexesUsed.map(idx => \`<code>\${idx}</code>\`).join(', ');
            }
            
            let scansHtml = 'None';
            if (stats.tablesScanStatus && Object.keys(stats.tablesScanStatus).length > 0) {
                scansHtml = Object.entries(stats.tablesScanStatus)
                    .map(([table, scanType]) => \`<div><code>\${table}</code> \${getScanBadge(scanType)}</div>\`)
                    .join('');
            }
            
            performanceStats.innerHTML = \`
                <div class="stats-grid">
                    <div class="stats-card">
                        <h3>Execution Times</h3>
                        <ul class="stats-list">
                            <li>
                                <span class="stats-label">Total Execution:</span>
                                <span class="stats-value">\${formatTime(stats.executionTime)}</span>
                            </li>
                            <li>
                                <span class="stats-label">Connection Time:</span>
                                <span class="stats-value">\${formatTime(stats.connectionTime)}</span>
                            </li>
                            <li>
                                <span class="stats-label">Query Planning:</span>
                                <span class="stats-value">\${formatTime(stats.queryPlanningTime)}</span>
                            </li>
                            <li>
                                <span class="stats-label">Query Execution:</span>
                                <span class="stats-value">\${formatTime(stats.queryExecutionTime)}</span>
                            </li>
                        </ul>
                    </div>
                    
                    <div class="stats-card">
                        <h3>Data Transfer</h3>
                        <ul class="stats-list">
                            <li>
                                <span class="stats-label">Rows Returned:</span>
                                <span class="stats-value">\${stats.rowsReturned?.toLocaleString() || 'N/A'}</span>
                            </li>
                            <li>
                                <span class="stats-label">Rows Affected:</span>
                                <span class="stats-value">\${stats.rowsAffected?.toLocaleString() || 'N/A'}</span>
                            </li>
                            <li>
                                <span class="stats-label">Data Received:</span>
                                <span class="stats-value">\${formatBytes(stats.bytesReceived)}</span>
                            </li>
                        </ul>
                    </div>
                    
                    <div class="stats-card">
                        <h3>Query Analysis</h3>
                        <ul class="stats-list">
                            <li>
                                <span class="stats-label">Complexity:</span>
                                <span class="stats-value \${getComplexityClass(stats.queryComplexity)}">\${stats.queryComplexity || 'Unknown'}</span>
                            </li>
                            <li>
                                <span class="stats-label">Cache Hits:</span>
                                <span class="stats-value">\${stats.cacheHits?.toLocaleString() || 'N/A'}</span>
                            </li>
                            <li>
                                <span class="stats-label">Disk Reads:</span>
                                <span class="stats-value">\${stats.diskReads?.toLocaleString() || 'N/A'}</span>
                            </li>
                        </ul>
                    </div>
                    
                    <div class="stats-card">
                        <h3>Indexes Used</h3>
                        <div style="font-size: 13px; line-height: 1.4;">
                            \${indexesHtml}
                        </div>
                    </div>
                    
                    <div class="stats-card">
                        <h3>Table Scans</h3>
                        <div style="font-size: 13px; line-height: 1.6;">
                            \${scansHtml}
                        </div>
                    </div>
                </div>
            \`;
        }
        
        function applyFilter() {
            const filterValue = filterInput.value.toLowerCase().trim();
            
            if (!filterValue) {
                filteredData = [...currentData];
            } else {
                filteredData = currentData.filter(row => {
                    return visibleColumns.some(col => {
                        const value = row[col];
                        const searchText = value === null ? 'null' : String(value).toLowerCase();
                        return searchText.includes(filterValue);
                    });
                });
            }
            
            // Re-apply sorting if active
            if (sortColumn) {
                applySorting();
            }
            
            displayTable();
        }
        
        function sortBy(column) {
            if (sortColumn === column) {
                // Toggle direction if same column
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                // New column, start with ascending
                sortColumn = column;
                sortDirection = 'asc';
            }
            
            applySorting();
            displayTable();
        }
        
        function applySorting() {
            if (!sortColumn) return;
            
            filteredData.sort((a, b) => {
                const aVal = a[sortColumn];
                const bVal = b[sortColumn];
                
                // Handle null values
                if (aVal === null && bVal === null) return 0;
                if (aVal === null) return sortDirection === 'asc' ? -1 : 1;
                if (bVal === null) return sortDirection === 'asc' ? 1 : -1;
                
                // Try numeric comparison first
                const aNum = Number(aVal);
                const bNum = Number(bVal);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
                }
                
                // String comparison
                const aStr = String(aVal).toLowerCase();
                const bStr = String(bVal).toLowerCase();
                if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1;
                if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        }
        
        function toggleColumnVisibility() {
            // Remove existing dropdown if present
            const existingDropdown = document.querySelector('.column-visibility-dropdown');
            if (existingDropdown) {
                existingDropdown.remove();
                return;
            }
            
            // Create dropdown
            const dropdown = document.createElement('div');
            dropdown.className = 'column-visibility-dropdown';
            
            originalColumns.forEach(col => {
                const item = document.createElement('div');
                item.className = 'column-visibility-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = visibleColumns.includes(col);
                checkbox.addEventListener('change', () => toggleColumn(col));
                
                const label = document.createElement('span');
                label.textContent = col;
                
                item.appendChild(checkbox);
                item.appendChild(label);
                dropdown.appendChild(item);
            });
            
            // Position dropdown relative to button
            columnVisibilityBtn.parentElement.style.position = 'relative';
            columnVisibilityBtn.parentElement.appendChild(dropdown);
            
            // Close dropdown when clicking outside
            setTimeout(() => {
                document.addEventListener('click', function closeDropdown(e) {
                    if (!dropdown.contains(e.target) && e.target !== columnVisibilityBtn) {
                        dropdown.remove();
                        document.removeEventListener('click', closeDropdown);
                    }
                });
            }, 0);
        }
        
        function toggleColumn(column) {
            const index = visibleColumns.indexOf(column);
            if (index > -1) {
                visibleColumns.splice(index, 1);
            } else {
                // Add column back in original order
                const originalIndex = originalColumns.indexOf(column);
                let insertIndex = 0;
                for (let i = 0; i < originalIndex; i++) {
                    if (visibleColumns.includes(originalColumns[i])) {
                        insertIndex++;
                    }
                }
                visibleColumns.splice(insertIndex, 0, column);
            }
            
            displayTable();
        }
        
        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'queryResult':
                    handleQueryResult(message);
                    break;
                    
                case 'setQuery':
                    if (sqlEditor) {
                        sqlEditor.setValue(message.query || '');
                        sqlEditor.focus();
                    }
                    break;
                    
                case 'initialize':
                    if (message.query && sqlEditor) {
                        sqlEditor.setValue(message.query);
                    }
                    if (message.database) {
                        updateStatus(\`Connected to: \${message.database}\`);
                    }
                    break;
                    
                case 'schemaForAutocomplete':
                    if (message.success && sqlEditor && message.schemaInfo) {
                        console.log('Received schema info for autocomplete:', message.schemaInfo);
                        sqlEditor.updateSchema(message.schemaInfo);
                    } else if (!message.success) {
                        console.warn('Failed to get schema for autocomplete:', message.error);
                    }
                    break;
                    
                case 'showError':
                    // Display validation errors to the user
                    console.error('SQL Validation Error:', message.message);
                    updateStatus('❌ ' + (message.message.split('\\n')[0] || 'Validation failed'), 'error');
                    
                    // Show detailed error in a more prominent way
                    const errorLines = message.message.split('\\n');
                    if (errorLines.length > 1) {
                        // Multi-line error, show in results area
                        resultsContainer.innerHTML = \`
                            <div style="padding: 20px; background: #ff1744; color: white; border-radius: 4px; margin: 10px;">
                                <h3 style="margin: 0 0 10px 0;">❌ Query Validation Failed</h3>
                                <pre style="margin: 0; white-space: pre-wrap; font-family: monospace;">\${message.message}</pre>
                            </div>
                        \`;
                        resultsInfo.textContent = 'Query blocked due to validation errors';
                    }
                    break;
                    
                case 'error':
                    updateStatus(\`Error: \${message.error}\`);
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        SqlQueryPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}