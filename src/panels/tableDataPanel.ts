import * as vscode from 'vscode';
import { TableDataService, TableDataResult, TableRow, ColumnDefinition, InsertRowData, UpdateRowData } from '../services/tableData.service';
import { StateService } from '../services/state.service';

export class TableDataPanel {
    public static currentPanels = new Map<string, TableDataPanel>();
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private currentPage = 0;
    private pageSize = 100;
    private tableData: TableDataResult | null = null;

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ) {
        const key = `${database || 'default'}.${schema}.${tableName}`;
        
        // If we already have a panel for this table, show it
        if (TableDataPanel.currentPanels.has(key)) {
            const existingPanel = TableDataPanel.currentPanels.get(key)!;
            existingPanel.panel.reveal();
            return;
        }

        // Otherwise, create a new panel
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const panel = vscode.window.createWebviewPanel(
            'tableData',
            `${schema}.${tableName}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                enableFindWidget: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        TableDataPanel.currentPanels.set(key, new TableDataPanel(panel, context, stateService, schema, tableName, database));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schema: string,
        private tableName: string,
        private database?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getWebviewContent();

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        // Load initial data
        this.loadTableData();
    }

    private async handleMessage(message: any) {
        const tableDataService = new TableDataService(this.stateService, this.context);
        
        switch (message.command) {
            case 'loadPage':
                this.currentPage = message.page;
                await this.loadTableData();
                break;

            case 'changeLimitSize':
                this.pageSize = message.limit;
                this.currentPage = 0; // Reset to first page when changing limit
                await this.loadTableData();
                break;

            case 'insertRow':
                try {
                    const newRow = await tableDataService.insertRow(
                        this.schema, 
                        this.tableName, 
                        message.rowData as InsertRowData,
                        this.database
                    );
                    
                    this.sendMessage({
                        command: 'rowInserted',
                        row: newRow,
                        success: true
                    });

                    // Refresh data to show the new row in the correct position
                    await this.loadTableData();
                } catch (error) {
                    this.sendMessage({
                        command: 'rowInserted',
                        error: error instanceof Error ? error.message : 'Unknown error',
                        success: false
                    });
                }
                break;

            case 'updateRow':
                try {
                    const updateData: UpdateRowData = {
                        primaryKeyValues: message.primaryKeyValues,
                        newValues: message.newValues
                    };
                    
                    const updatedRow = await tableDataService.updateRow(
                        this.schema, 
                        this.tableName, 
                        updateData,
                        this.database
                    );
                    
                    this.sendMessage({
                        command: 'rowUpdated',
                        row: updatedRow,
                        success: true
                    });

                    // Refresh data to show the updated row
                    await this.loadTableData();
                } catch (error) {
                    this.sendMessage({
                        command: 'rowUpdated',
                        error: error instanceof Error ? error.message : 'Unknown error',
                        success: false
                    });
                }
                break;

            case 'deleteRow':
                try {
                    await tableDataService.deleteRow(
                        this.schema, 
                        this.tableName, 
                        message.primaryKeyValues,
                        this.database
                    );
                    
                    this.sendMessage({
                        command: 'rowDeleted',
                        success: true
                    });

                    // Refresh data to remove the deleted row
                    await this.loadTableData();
                } catch (error) {
                    this.sendMessage({
                        command: 'rowDeleted',
                        error: error instanceof Error ? error.message : 'Unknown error',
                        success: false
                    });
                }
                break;

            case 'validateRow':
                try {
                    const validation = tableDataService.validateRowData(message.rowData, this.tableData?.columns || []);
                    this.sendMessage({
                        command: 'validationResult',
                        validation
                    });
                } catch (error) {
                    this.sendMessage({
                        command: 'validationResult',
                        validation: { isValid: false, errors: ['Validation failed'] }
                    });
                }
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

            case 'refresh':
                await this.loadTableData();
                break;
        }
    }

    private async loadTableData() {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            const tableDataService = new TableDataService(this.stateService, this.context);
            this.tableData = await tableDataService.getTableData(
                this.schema, 
                this.tableName, 
                this.currentPage * this.pageSize, 
                this.pageSize,
                this.database
            );

            this.sendMessage({
                command: 'dataLoaded',
                data: this.tableData,
                page: this.currentPage,
                pageSize: this.pageSize
            });
        } catch (error) {
            this.sendMessage({
                command: 'error',
                error: error instanceof Error ? error.message : 'Failed to load table data'
            });
        } finally {
            this.sendMessage({ command: 'loading', loading: false });
        }
    }

    private sendMessage(message: any) {
        this.panel.webview.postMessage(message);
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

            // Use the database from the table data panel context
            const branchConnectionInfos = viewData.connection.branchConnectionInfos;
            const database = this.database || viewData.selectedDatabase || branchConnectionInfos?.[0]?.database || 'neondb';
            
            // Construct the Neon console URL for the specific table
            // The URL pattern might be different for specific tables, using the general tables view with filters
            const tableViewUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/tables?database=${database}&schema=${this.schema}&table=${this.tableName}`;
            
            // Open in external browser
            await vscode.env.openExternal(vscode.Uri.parse(tableViewUrl));
        } catch (error) {
            console.error('Error opening Neon console:', error);
            throw error;
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Table Data: ${this.schema}.${this.tableName}</title>
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

        .table-indicator {
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

        .table-indicator .table-icon {
            width: 12px;
            height: 12px;
            margin-right: 4px;
            flex-shrink: 0;
        }

        .table-indicator .table-icon svg {
            width: 100%;
            height: 100%;
            color: var(--vscode-badge-foreground);
        }

        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }

        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .table-container {
            flex: 1;
            overflow: auto;
            background-color: var(--vscode-editor-background);
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        th, td {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            border-right: 1px solid var(--vscode-panel-border);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 200px;
            position: relative;
        }

        th {
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 10;
            opacity: 1;
            backdrop-filter: blur(0px);
        }

        th:first-child {
            z-index: 11;
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            opacity: 1;
        }

        .row-number {
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            position: sticky;
            left: 0;
            z-index: 9;
            font-weight: bold;
            text-align: center;
            width: 60px;
            min-width: 60px;
            max-width: 60px;
            opacity: 1;
        }

        .actions-cell {
            position: sticky;
            right: 0;
            background-color: var(--vscode-editor-background);
            z-index: 9;
            text-align: center;
            width: 60px;
            min-width: 60px;
            max-width: 60px;
        }

        .actions-header {
            position: sticky;
            right: 0;
            background-color: var(--vscode-list-headerBackground, var(--vscode-editor-background));
            z-index: 11;
            width: 60px;
            min-width: 60px;
            max-width: 60px;
            opacity: 1;
        }

        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        tr:hover .actions-cell {
            background-color: var(--vscode-list-hoverBackground);
        }

        .editable-cell {
            cursor: pointer;
        }



        .cell-editor, .cell-input {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            box-sizing: border-box;
            transition: border-color 0.2s, box-shadow 0.2s;
            outline: none;
        }
        
        .cell-editor:focus, .cell-input:focus {
            border-color: var(--vscode-focusBorder);
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        .cell-editor:hover:not(:focus), .cell-input:hover:not(:focus) {
            border-color: var(--vscode-input-border);
        }
        
        /* JSON Editor Styles */
        .json-editor {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            font-size: 12px;
            resize: both;
            min-height: 80px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 8px;
            transition: border-color 0.2s;
            outline: none;
        }
        
        .json-editor:focus {
            border-color: var(--vscode-focusBorder);
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        /* Array Editor Styles */
        .array-editor {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            font-size: 12px;
            resize: both;
            min-height: 60px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 8px;
            transition: border-color 0.2s;
            outline: none;
        }
        
        .array-editor:focus {
            border-color: var(--vscode-focusBorder);
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        /* Text Editor Styles */
        .text-editor {
            resize: both;
            min-height: 60px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 8px;
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            font-size: 12px;
            transition: border-color 0.2s;
            outline: none;
        }
        
        .text-editor:focus {
            border-color: var(--vscode-focusBorder);
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        /* Input validation error styles */
        .cell-editor.validation-error {
            border-color: var(--vscode-inputValidation-errorBorder);
            background-color: var(--vscode-inputValidation-errorBackground);
        }
        
        /* Improved input styles for different types */
        .cell-editor[type="date"],
        .cell-editor[type="time"],
        .cell-editor[type="datetime-local"] {
            min-width: 150px;
        }
        
        .cell-editor[type="number"] {
            text-align: right;
        }
        
        /* Data type specific cell styles */
        .json-cell {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            background-color: rgba(0, 100, 200, 0.1);
            border-left: 3px solid var(--vscode-charts-blue);
        }
        
        .json-cell.invalid-json {
            background-color: rgba(200, 50, 50, 0.1);
            border-left: 3px solid var(--vscode-errorForeground);
        }
        
        .array-cell {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            background-color: rgba(100, 150, 100, 0.1);
            border-left: 3px solid var(--vscode-charts-green);
        }
        
        .uuid-cell {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            background-color: rgba(150, 100, 200, 0.1);
            border-left: 3px solid var(--vscode-charts-purple);
            font-size: 11px;
        }
        
        .bool-cell {
            text-align: center;
            font-weight: bold;
        }
        
        .bool-cell.bool-true {
            color: var(--vscode-charts-green);
        }
        
        .bool-cell.bool-false {
            color: var(--vscode-charts-red);
        }
        
        .datetime-cell {
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
            background-color: rgba(200, 150, 50, 0.1);
            border-left: 3px solid var(--vscode-charts-orange);
        }
        
        .numeric-cell {
            text-align: right;
            font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', 'Courier New', monospace);
        }
        
        .text-cell {
            max-width: 300px;
            word-break: break-word;
        }

        .page-info {
            color: var(--vscode-statusBar-foreground);
            font-size: 12px;
        }

        .pagination-controls {
            display: flex;
            align-items: center;
            gap: 8px;
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

        .no-data {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px;
            color: var(--vscode-descriptionForeground);
        }



        .action-btn {
            color: var(--vscode-foreground);
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            border-radius: 2px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin: 0 2px;
        }

        .action-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        .action-btn svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .edit-btn:hover {
            color: var(--vscode-charts-blue);
        }

        .delete-btn:hover {
            color: var(--vscode-errorForeground);
        }

        .save-btn:hover {
            color: var(--vscode-charts-green);
        }

        .cancel-btn:hover {
            color: var(--vscode-charts-orange);
        }

        .row-editing .editable-cell {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            cursor: pointer;
        }



        .new-row {
            background-color: var(--vscode-inputValidation-infoBackground, var(--vscode-list-hoverBackground));
            border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder));
        }

        .new-row .row-number {
            font-weight: bold;
            color: var(--vscode-inputValidation-infoForeground, var(--vscode-foreground));
        }

        .primary-key {
            font-weight: bold;
            color: var(--vscode-charts-yellow);
        }

        .foreign-key {
            color: var(--vscode-charts-blue);
        }

        .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        /* Modal styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
        }

        .modal-content {
            background-color: var(--vscode-editor-background);
            margin: 10% auto;
            padding: 20px;
            border: 1px solid var(--vscode-panel-border);
            width: 80%;
            max-width: 600px;
            border-radius: 3px;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .modal-title {
            font-size: 16px;
            font-weight: bold;
        }

        .close {
            color: var(--vscode-foreground);
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }

        .close:hover {
            color: var(--vscode-errorForeground);
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }

        .form-input {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            border-radius: 3px;
            font-size: 13px;
            font-family: inherit;
        }

        .form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .required {
            color: var(--vscode-errorForeground);
        }

        .column-info {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        /* Confirmation Dialog */
        .confirm-dialog {
            display: none;
            position: fixed;
            z-index: 2000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.6);
        }

        .confirm-content {
            background-color: var(--vscode-editor-background);
            margin: 20% auto;
            padding: 20px;
            border: 1px solid var(--vscode-panel-border);
            width: 400px;
            max-width: 80%;
            border-radius: 3px;
            text-align: center;
        }

        .confirm-message {
            margin-bottom: 20px;
            font-size: 14px;
            line-height: 1.4;
        }

        .confirm-actions {
            display: flex;
            justify-content: center;
            gap: 12px;
        }

        /* Limit Selector */
        .status-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background-color: var(--vscode-statusBar-background);
            color: var(--vscode-statusBar-foreground);
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 12px;
            flex-shrink: 0;
        }

        .status-left {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }

        .status-center {
            display: flex;
            align-items: center;
            gap: 8px;
            justify-content: center;
            flex: 0 0 auto;
        }

        .status-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
            justify-content: flex-end;
        }

        .limit-selector {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .limit-select {
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 12px;
            cursor: pointer;
        }

        .limit-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .filter-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-right: 12px;
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

        .control-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 12px;
        }

        .control-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
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
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="toolbar-left">
            <button class="btn" id="addRowBtn">Add Row</button>
            <button class="btn btn-secondary" id="refreshBtn">Refresh</button>
            <span class="table-indicator" title="Current table">
                <span class="table-icon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 3.5A2.5 2.5 0 0 1 3.5 1h9A2.5 2.5 0 0 1 15 3.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5v-9Z" stroke="currentColor" stroke-width="1" fill="none"/>
                        <path d="M1 6h14M1 10h14M6 1v14" stroke="currentColor" stroke-width="1"/>
                    </svg>
                </span>
                <span>${this.schema}.${this.tableName}</span>
            </span>
        </div>
        <div class="toolbar-right">
            <div class="filter-controls">
                <input type="text" id="filterInput" placeholder="Filter data..." class="filter-input" />
                <button id="columnVisibilityBtn" class="control-btn" title="Show/Hide Columns">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M2 3h12v1H2V3zm0 3h12v1H2V6zm0 3h12v1H2V9zm0 3h12v1H2v-1z"/>
                        <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11z" fill="none" stroke="currentColor" stroke-width="0.5"/>
                    </svg>
                </button>
            </div>
            <button class="btn btn-secondary" id="openNeonConsoleBtn" title="Open this table in Neon console">Open in Neon console</button>
        </div>
    </div>
    
    <div class="table-container" id="tableContainer">
        <div class="loading">Loading table data...</div>
    </div>
    
    <div class="status-bar" id="statusBar">
        <div class="status-left">
            <span id="statusText">Loading...</span>
        </div>
        <div class="status-center">
            <div class="pagination-controls" id="pagination" style="display: none;">
                <button class="btn btn-secondary" id="prevPageBtn" disabled>Previous</button>
                <span class="page-info" id="pageInfo">Page 1</span>
                <button class="btn btn-secondary" id="nextPageBtn" disabled>Next</button>
            </div>
        </div>
        <div class="status-right">
            <div class="limit-selector">
                <label for="limitSelect">Rows per page:</label>
                <select id="limitSelect" class="limit-select">
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100" selected>100</option>
                    <option value="200">200</option>
                    <option value="500">500</option>
                    <option value="1000">1000</option>
                </select>
            </div>
        </div>
    </div>



    <!-- Confirmation Dialog -->
    <div id="confirmDialog" class="confirm-dialog">
        <div class="confirm-content">
            <div class="confirm-message" id="confirmMessage">
                Are you sure you want to delete this row?
            </div>
            <div class="confirm-actions">
                <button class="btn btn-secondary" id="confirmCancel">Cancel</button>
                <button class="btn btn-danger" id="confirmDelete">Delete</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let currentData = null;
        let filteredData = [];
        let originalColumns = [];
        let visibleColumns = [];
        let sortColumn = null;
        let sortDirection = 'asc';
        let currentPage = 0;
        let pageSize = 100;
        let editingCell = null;
        let columns = [];
        let pendingDeleteRow = null;
        let editingRowIndex = -1;
        let isAddingNewRow = false;
        let newRowData = {};
        
        // Elements
        const tableContainer = document.getElementById('tableContainer');
        const pagination = document.getElementById('pagination');
        const statusBar = document.getElementById('statusBar');
        const statusText = document.getElementById('statusText');
        const addRowBtn = document.getElementById('addRowBtn');
        const refreshBtn = document.getElementById('refreshBtn');
        const openNeonConsoleBtn = document.getElementById('openNeonConsoleBtn');
        const prevPageBtn = document.getElementById('prevPageBtn');
        const nextPageBtn = document.getElementById('nextPageBtn');
        const pageInfo = document.getElementById('pageInfo');
        const limitSelect = document.getElementById('limitSelect');
        const filterInput = document.getElementById('filterInput');
        const columnVisibilityBtn = document.getElementById('columnVisibilityBtn');
        
        // Modal elements (for confirmation dialog only)
        
        // Confirmation dialog elements
        const confirmDialog = document.getElementById('confirmDialog');
        const confirmMessage = document.getElementById('confirmMessage');
        const confirmCancel = document.getElementById('confirmCancel');
        const confirmDelete = document.getElementById('confirmDelete');
        
        // Event listeners
        addRowBtn.addEventListener('click', startAddNewRow);
        refreshBtn.addEventListener('click', refresh);
        openNeonConsoleBtn.addEventListener('click', openNeonConsole);
        prevPageBtn.addEventListener('click', () => loadPage(currentPage - 1));
        nextPageBtn.addEventListener('click', () => loadPage(currentPage + 1));
        limitSelect.addEventListener('change', changeLimitSize);
        filterInput.addEventListener('input', applyFilter);
        columnVisibilityBtn.addEventListener('click', toggleColumnVisibility);

        
        // Confirmation dialog event listeners
        confirmCancel.addEventListener('click', hideConfirmDialog);
        confirmDelete.addEventListener('click', confirmDeleteRow);
        
        // Modal click outside to close
        window.addEventListener('click', (e) => {
            if (e.target === confirmDialog) {
                hideConfirmDialog();
            }
        });
        
        // Message handling
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'dataLoaded':
                    handleDataLoaded(message);
                    break;
                    
                case 'loading':
                    handleLoading(message.loading);
                    break;
                    
                case 'error':
                    handleError(message.error);
                    break;
                    
                case 'rowInserted':
                case 'rowUpdated':
                case 'rowDeleted':
                    handleRowOperation(message);
                    break;
                    
                case 'validationResult':
                    handleValidation(message.validation);
                    break;
            }
        });
        
        function handleDataLoaded(message) {
            currentData = message.data;
            currentPage = message.page;
            pageSize = message.pageSize;
            columns = currentData.columns;
            originalColumns = currentData.columns.map(col => col.name);
            visibleColumns = [...originalColumns];
            filteredData = [...currentData.rows];
            sortColumn = null;
            sortDirection = 'asc';
            filterInput.value = '';
            
            // Update the limit selector to match the current pageSize
            limitSelect.value = pageSize.toString();
            
            displayTable(currentData);
            updatePagination();
            updateStatus(\`Showing \${filteredData.length} of \${currentData.totalCount} rows\`);
        }
        
        function loadPage(page) {
            vscode.postMessage({
                command: 'loadPage',
                page: page
            });
        }
        
        function handleLoading(loading) {
            if (loading) {
                tableContainer.innerHTML = '<div class="loading">Loading...</div>';
                updateStatus('Loading...');
            }
        }
        
        function handleError(error) {
            tableContainer.innerHTML = \`<div class="error">Error: \${error}</div>\`;
            updateStatus('Error');
        }
        
        function handleRowOperation(message) {
            if (message.success) {
                updateStatus('Operation completed successfully');
                
                // Reset editing state for successful operations
                // (Table will be refreshed via dataLoaded message from backend)
                if (isAddingNewRow) {
                    isAddingNewRow = false;
                    newRowData = {};
                    editingRowIndex = -1;
                } else if (editingRowIndex !== -1) {
                    editingRowIndex = -1;
                }
            } else {
                updateStatus(\`Error: \${message.error}\`);
                showErrorMessage(\`Error: \${message.error}\`);
                
                // Re-render the table to restore the editing row with functional buttons
                // Keep the editing state so user can fix the error and try again
                displayTable(currentData);
            }
        }
        
        function handleValidation(validation) {
            if (!validation.isValid) {
                showErrorMessage('Validation errors:\\n' + validation.errors.join('\\n'));
            }
        }
        
        function displayTable(data) {
            // If we don't have any data structure and we're not adding a new row, show no data message
            if (!data || (!data.columns || data.columns.length === 0)) {
                tableContainer.innerHTML = '<div class="no-data">No data to display</div>';
                return;
            }
            
            // If we have column structure but no data rows and we're not adding a new row, show a different message
            if (filteredData.length === 0 && !isAddingNewRow) {
                // Still create the table structure so Add Row button can work
                // But show "empty table" message in the table body
            }
            
            const table = document.createElement('table');
            
            // Create header
            const thead = document.createElement('thead');
            const headerRow = document.createElement('tr');
            
            // Row number header
            const rowNumHeader = document.createElement('th');
            rowNumHeader.className = 'row-number';
            rowNumHeader.textContent = '#';
            headerRow.appendChild(rowNumHeader);
            
            // Column headers (only visible columns)
            data.columns.forEach(col => {
                if (!visibleColumns.includes(col.name)) return;
                
                const th = document.createElement('th');
                th.textContent = col.name;
                th.title = \`\${col.type}\${col.nullable ? '' : ' (NOT NULL)'}\${col.isPrimaryKey ? ' (PK)' : ''}\${col.isForeignKey ? ' (FK)' : ''}\`;
                th.className = 'sortable-header';
                th.style.position = 'relative';
                
                if (col.isPrimaryKey) {
                    th.classList.add('primary-key');
                } else if (col.isForeignKey) {
                    th.classList.add('foreign-key');
                }
                
                // Add sort indicator if this column is being sorted
                if (sortColumn === col.name) {
                    const sortIndicator = document.createElement('span');
                    sortIndicator.className = 'sort-indicator';
                    sortIndicator.textContent = sortDirection === 'asc' ? '↑' : '↓';
                    th.appendChild(sortIndicator);
                }
                
                // Add click handler for sorting
                th.addEventListener('click', () => sortBy(col.name));
                
                headerRow.appendChild(th);
            });
            
            // Actions header
            const actionsHeader = document.createElement('th');
            actionsHeader.className = 'actions-header';
            actionsHeader.innerHTML = '';
            actionsHeader.title = 'Actions';
            headerRow.appendChild(actionsHeader);
            
            thead.appendChild(headerRow);
            table.appendChild(thead);
            
            // Create body
            const tbody = document.createElement('tbody');
            
            // Add new row at top if we're adding
            if (isAddingNewRow) {
                const newTr = createNewRowElement();
                tbody.appendChild(newTr);
            }
            
            // If no data and not adding a new row, show empty table message
            if (filteredData.length === 0 && !isAddingNewRow) {
                const emptyRow = document.createElement('tr');
                const emptyCell = document.createElement('td');
                emptyCell.colSpan = data.columns.length + 2; // +2 for row number and actions columns
                emptyCell.textContent = 'No data in this table. Click "Add Row" to add the first row.';
                emptyCell.style.textAlign = 'center';
                emptyCell.style.fontStyle = 'italic';
                emptyCell.style.color = 'var(--vscode-descriptionForeground)';
                emptyCell.style.padding = '32px';
                emptyRow.appendChild(emptyCell);
                tbody.appendChild(emptyRow);
            }
            
            filteredData.forEach((row, index) => {
                const tr = document.createElement('tr');
                tr.dataset.rowIndex = index;
                
                if (editingRowIndex === index) {
                    tr.classList.add('row-editing');
                }
                
                // Row number
                const rowNumCell = document.createElement('td');
                rowNumCell.className = 'row-number';
                rowNumCell.textContent = (currentPage * pageSize) + index + 1;
                tr.appendChild(rowNumCell);
                
                // Data cells (only visible columns)
                data.columns.forEach(col => {
                    if (!visibleColumns.includes(col.name)) return;
                    const td = document.createElement('td');
                    const value = row[col.name];
                    
                    if (value === null || value === undefined) {
                        td.textContent = 'NULL';
                        td.classList.add('null-value');
                    } else {
                        // Format value for display based on column type
                        const displayValue = formatValueForDisplay(value, col.type);
                        td.textContent = displayValue.text;
                        td.title = displayValue.tooltip;
                        
                        // Add special styling for different data types
                        if (displayValue.className) {
                            // Split className string and add each class individually
                            const classes = displayValue.className.split(' ').filter(c => c.trim());
                            classes.forEach(cls => td.classList.add(cls));
                        }
                    }
                    td.classList.add('editable-cell');
                    td.dataset.column = col.name;
                    
                    // Only add click handler if row is in editing mode
                    if (editingRowIndex === index) {
                        td.addEventListener('click', () => startCellEdit(td, row, col));
                    }
                    
                    if (col.isPrimaryKey) {
                        td.classList.add('primary-key');
                    } else if (col.isForeignKey) {
                        td.classList.add('foreign-key');
                    }
                    
                    tr.appendChild(td);
                });
                
                // Actions cell
                const actionsCell = document.createElement('td');
                actionsCell.className = 'actions-cell';
                actionsCell.innerHTML = editingRowIndex === index 
                    ? \`
                        <button class="action-btn save-btn" onclick="saveRowEdit(\${index})" title="Save changes">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                            </svg>
                        </button>
                        <button class="action-btn cancel-btn" onclick="cancelRowEdit(\${index})" title="Cancel changes">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
                            </svg>
                        </button>
                    \`
                    : \`
                        <button class="action-btn edit-btn" onclick="startRowEdit(\${index})" title="Edit row">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                                <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/>
                            </svg>
                        </button>
                        <button class="action-btn delete-btn" onclick="deleteRow(\${index})" title="Delete row">
                            <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
                                <path d="M6.5 1h3a.5.5 0 0 1 .5.5v1H6v-1a.5.5 0 0 1 .5-.5ZM11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3A1.5 1.5 0 0 0 5 1.5v1H2.506a.5.5 0 0 0 0 1h.5v10A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-10h.5a.5.5 0 0 0 0-1H11ZM4.5 4a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5ZM8 4a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8A.5.5 0 0 1 8 4Zm3.5 0a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5Z"/>
                            </svg>
                        </button>
                    \`;
                tr.appendChild(actionsCell);
                
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            
            tableContainer.innerHTML = '';
            tableContainer.appendChild(table);
        }
        
        function startRowEdit(index) {
            // Cancel any existing edit
            if (editingRowIndex !== -1) {
                cancelRowEdit(editingRowIndex);
            }
            
            editingRowIndex = index;
            
            // Re-render the table to show edit mode
            displayTable(currentData);
            
            // Convert all cells in this row to input fields
            setTimeout(() => {
                convertRowToInputs(index);
            }, 0);
        }
        
        function convertRowToInputs(index) {
            const rowElement = document.querySelector('tr[data-row-index="' + index + '"]');
            if (!rowElement) return;
            
            const editableCells = rowElement.querySelectorAll('.editable-cell');
            const row = currentData.rows[index];
            
            editableCells.forEach(cell => {
                const columnName = cell.dataset.column;
                const column = columns.find(col => col.name === columnName);
                if (!column) return;
                
                const inputElement = createInputElement(column, row[column.name]);
                inputElement.className = 'cell-editor';
                inputElement.dataset.column = column.name;
                
                // Add keyboard navigation
                addKeyboardNavigation(inputElement, cell, index);
                
                // Replace cell content with input
                cell.innerHTML = '';
                cell.appendChild(inputElement);
            });
            
            // Focus the first input
            const firstInput = rowElement.querySelector('.cell-editor');
            if (firstInput) {
                firstInput.focus();
                firstInput.select();
            }
        }

        function saveRowEdit(index) {
            if (editingRowIndex !== index) return;
            
            const row = currentData.rows[index];
            const primaryKeyValues = getPrimaryKeyValues(row);
            const changes = {};
            let hasChanges = false;
            
            // Collect all changes from the row
            const rowElement = document.querySelector(\`tr[data-row-index="\${index}"]\`);
            const inputs = rowElement.querySelectorAll('.cell-editor');
            
            inputs.forEach(input => {
                const columnName = input.dataset.column;
                const column = columns.find(col => col.name === columnName);
                const newValue = extractValueFromInput(input, column);
                const originalValue = row[columnName];
                
                if (newValue !== originalValue) {
                    changes[columnName] = newValue;
                    hasChanges = true;
                }
            });
            
            if (hasChanges) {
                vscode.postMessage({
                    command: 'updateRow',
                    primaryKeyValues,
                    newValues: changes
                });
                // Don't reset state here - wait for response from backend
                // State will be reset in handleRowOperation() based on success/failure
            } else {
                // No changes, just cancel the edit
                editingRowIndex = -1;
                displayTable(currentData);
            }
        }

        function cancelRowEdit(index) {
            if (editingRowIndex !== index) return;
            
            editingRowIndex = -1;
            displayTable(currentData);
        }
        
        function startCellEdit(cell, row, column) {
            // Only allow editing if the row is in edit mode
            if (editingRowIndex === -1) return;
            
            // If the cell already has an input, just focus it
            const existingInput = cell.querySelector('.cell-editor');
            if (existingInput) {
                existingInput.focus();
                existingInput.select();
                return;
            }
            
            // This function is now mainly for focusing existing inputs
            // since convertRowToInputs handles the initial conversion
        }
        
        function findNextEditableCell(currentCell) {
            const row = currentCell.closest('tr');
            const cells = Array.from(row.querySelectorAll('.editable-cell'));
            const currentIndex = cells.indexOf(currentCell);
            
            if (currentIndex < cells.length - 1) {
                const nextCell = cells[currentIndex + 1];
                const rowData = currentData.rows[parseInt(row.dataset.rowIndex)];
                const columnName = nextCell.dataset.column;
                const column = columns.find(col => col.name === columnName);
                
                return { cell: nextCell, row: rowData, column };
            }
            
            return null;
        }
        
        function findPreviousEditableCell(currentCell) {
            const row = currentCell.closest('tr');
            const cells = Array.from(row.querySelectorAll('.editable-cell'));
            const currentIndex = cells.indexOf(currentCell);
            
            if (currentIndex > 0) {
                const prevCell = cells[currentIndex - 1];
                const rowData = currentData.rows[parseInt(row.dataset.rowIndex)];
                const columnName = prevCell.dataset.column;
                const column = columns.find(col => col.name === columnName);
                
                return { cell: prevCell, row: rowData, column };
            }
            
            return null;
        }
        
        function saveCellEdit() {
            if (!editingCell) return;
            
            const { cell, row, column } = editingCell;
            const input = cell.querySelector('.cell-editor');
            const newValue = input.value.trim() === '' ? null : input.value;
            
            if (newValue !== editingCell.originalValue) {
                const primaryKeyValues = getPrimaryKeyValues(row);
                const newValues = { [column.name]: newValue };
                
                vscode.postMessage({
                    command: 'updateRow',
                    primaryKeyValues,
                    newValues
                });
            }
            
            editingCell = null;
        }
        
        function cancelCellEdit() {
            if (!editingCell) return;
            
            const { cell, originalValue } = editingCell;
            
            if (originalValue === null) {
                cell.textContent = 'NULL';
                cell.classList.add('null-value');
            } else {
                cell.textContent = String(originalValue);
                cell.classList.remove('null-value');
            }
            
            editingCell = null;
        }
        
        function deleteRow(index) {
            if (!currentData || !currentData.rows[index]) return;
            
            const row = currentData.rows[index];
            const primaryKeyValues = getPrimaryKeyValues(row);
            
            if (Object.keys(primaryKeyValues).length === 0) {
                showErrorMessage('Cannot delete row: No primary key found');
                return;
            }
            
            // Store the row to delete and show confirmation dialog
            pendingDeleteRow = { index, primaryKeyValues };
            showConfirmDialog('Are you sure you want to delete this row?');
        }
        
        function showConfirmDialog(message) {
            confirmMessage.textContent = message;
            confirmDialog.style.display = 'block';
        }
        
        function hideConfirmDialog() {
            confirmDialog.style.display = 'none';
            pendingDeleteRow = null;
            // Reset dialog state
            confirmDelete.style.display = 'inline-block';
            confirmCancel.textContent = 'Cancel';
        }
        
        function confirmDeleteRow() {
            if (pendingDeleteRow) {
                vscode.postMessage({
                    command: 'deleteRow',
                    primaryKeyValues: pendingDeleteRow.primaryKeyValues
                });
                hideConfirmDialog();
            }
        }
        
        function getPrimaryKeyValues(row) {
            const pkValues = {};
            const primaryKeyColumns = columns.filter(col => col.isPrimaryKey);
            
            if (primaryKeyColumns.length > 0) {
                // Use actual primary key columns
                primaryKeyColumns.forEach(col => {
                    pkValues[col.name] = row[col.name];
                });
            } else {
                // Fallback: use all non-null columns as identifier
                // This is not ideal but allows updates on tables without primary keys
                console.warn('Table has no primary key, using all columns as identifier for update');
                columns.forEach(col => {
                    const value = row[col.name];
                    if (value !== null && value !== undefined) {
                        pkValues[col.name] = value;
                    }
                });
            }
            
            return pkValues;
        }
        
        function startAddNewRow() {
            if (isAddingNewRow) {
                return; // Already adding a row
            }
            
            // Check if we have column definitions
            if (!columns || columns.length === 0) {
                updateStatus('Cannot add row: Table structure not loaded');
                return;
            }
            
            // Cancel any existing edit
            if (editingRowIndex !== -1) {
                cancelRowEdit(editingRowIndex);
            }
            
            // Initialize new row data with empty values
            newRowData = {};
            columns.forEach(col => {
                newRowData[col.name] = '';
            });
            
            isAddingNewRow = true;
            editingRowIndex = -1; // New row is at index -1
            
            // Re-render table with new row at top
            displayTable(currentData);
            
            // Scroll to top
            tableContainer.scrollTop = 0;
            
            // Focus first input in the new row
            setTimeout(() => {
                const firstInput = tableContainer.querySelector('tr[data-row-index="-1"] input');
                if (firstInput) {
                    firstInput.focus();
                }
            }, 100);
        }
        
        function saveNewRow() {
            if (!isAddingNewRow) return;
            
            // Collect data from inputs
            const rowData = {};
            const newRow = tableContainer.querySelector('tr[data-row-index="-1"]');
            if (!newRow) return;
            
            const inputs = newRow.querySelectorAll('.cell-input');
            inputs.forEach(input => {
                const columnName = input.dataset.column;
                if (columnName) {
                    const column = columns.find(col => col.name === columnName);
                    const value = extractValueFromInput(input, column);
                    if (value !== null && value !== '') {
                        rowData[columnName] = value;
                    }
                }
            });
            
            // Send to backend
            vscode.postMessage({
                command: 'insertRow',
                rowData
            });
            
            // Don't reset state here - wait for response from backend
            // State will be reset in handleRowOperation() based on success/failure
        }
        
        function cancelNewRow() {
            if (!isAddingNewRow) return;
            
            isAddingNewRow = false;
            newRowData = {};
            editingRowIndex = -1;
            
            // Re-render table without new row
            displayTable(currentData);
        }
        
        function createNewRowElement() {
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = '-1';
            tr.classList.add('row-editing', 'new-row');
            
            // Row number cell (show as "New")
            const rowNumCell = document.createElement('td');
            rowNumCell.className = 'row-number';
            rowNumCell.textContent = 'New';
            tr.appendChild(rowNumCell);
            
            // Data cells with inputs (only visible columns)
            columns.forEach(col => {
                if (!visibleColumns.includes(col.name)) return;
                
                const td = document.createElement('td');
                td.classList.add('editable-cell');
                td.dataset.column = col.name;
                
                const input = createInputElement(col, newRowData[col.name] || '');
                input.dataset.column = col.name;
                input.placeholder = col.defaultValue ? 'Default: ' + col.defaultValue : getPlaceholderText(col.type);
                input.className = 'cell-input';
                
                if (col.isPrimaryKey) {
                    td.classList.add('primary-key');
                } else if (col.isForeignKey) {
                    td.classList.add('foreign-key');
                }
                
                // Save input value to newRowData on change
                input.addEventListener('input', (e) => {
                    newRowData[col.name] = e.target.value;
                });
                
                // Handle tab navigation
                addNewRowKeyboardNavigation(input);
                
                td.appendChild(input);
                tr.appendChild(td);
            });
            
            // Actions cell with save/cancel buttons
            const actionsCell = document.createElement('td');
            actionsCell.className = 'actions-cell';
            actionsCell.innerHTML = 
                '<button class="action-btn save-btn" onclick="saveNewRow()" title="Save new row">' +
                    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>' +
                    '</svg>' +
                '</button>' +
                '<button class="action-btn cancel-btn" onclick="cancelNewRow()" title="Cancel new row">' +
                    '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' +
                        '<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>' +
                    '</svg>' +
                '</button>';
            tr.appendChild(actionsCell);
            
            return tr;
        }
        

        
        function getInputType(dataType) {
            const type = dataType.toLowerCase();
            
            // Numeric types
            if (type.includes('int') || type.includes('serial')) return 'number';
            if (type.includes('numeric') || type.includes('decimal') || type.includes('float') || type.includes('double') || type.includes('real')) return 'number';
            
            // Boolean
            if (type.includes('bool')) return 'checkbox';
            
            // Date/Time types - use specific input types for better UX
            if (type === 'date') return 'date';
            if (type === 'time' || type.includes('time without time zone')) return 'time';
            if (type.includes('timestamp') || type.includes('datetime')) return 'datetime-local';
            
            // For all other types including JSON, JSONB, TEXT, VARCHAR, UUID, ARRAY, etc.
            // Use text input as it's the most flexible for complex data types
            return 'text';
        }
        
        function createInputElement(column, value) {
            const type = column.type.toLowerCase();
            
            // Handle JSON/JSONB types specially
            if (type === 'json' || type === 'jsonb') {
                return createJsonEditor(column, value);
            }
            
            // Handle arrays
            if (type.includes('[]') || type.includes('array')) {
                return createArrayEditor(column, value);
            }
            
            // Handle large text types with textarea
            if (type === 'text' || type.includes('character varying') && column.maxLength > 255) {
                return createTextareaEditor(column, value);
            }
            
            // Handle boolean specially
            if (type.includes('bool')) {
                return createBooleanEditor(column, value);
            }
            
            // Default to standard input
            const input = document.createElement('input');
            input.type = getInputType(column.type);
            input.value = formatValueForInput(value, column.type);
            
            // Add validation attributes
            addInputValidation(input, column);
            
            return input;
        }
        
        function createJsonEditor(column, value) {
            const textarea = document.createElement('textarea');
            textarea.className = 'json-editor';
            textarea.rows = 3;
            
            // Format JSON for display
            let formattedValue = '';
            if (value !== null && value !== undefined && value !== '') {
                try {
                    // If it's already a string, try to parse it
                    const jsonValue = typeof value === 'string' ? JSON.parse(value) : value;
                    formattedValue = JSON.stringify(jsonValue, null, 2);
                } catch (e) {
                    // If parsing fails, just show the raw value
                    formattedValue = String(value);
                }
            }
            textarea.value = formattedValue;
            
            // Add JSON validation on blur
            textarea.addEventListener('blur', function() {
                if (this.value.trim() === '') return;
                try {
                    JSON.parse(this.value);
                    this.style.borderColor = '';
                    this.title = '';
                } catch (e) {
                    this.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
                    this.title = 'Invalid JSON: ' + e.message;
                }
            });
            
            return textarea;
        }
        
        function createArrayEditor(column, value) {
            const textarea = document.createElement('textarea');
            textarea.className = 'array-editor';
            textarea.rows = 2;
            textarea.placeholder = 'Enter array values, e.g., [1,2,3] or ["a","b","c"]';
            
            // Format array for display
            let formattedValue = '';
            if (value !== null && value !== undefined && value !== '') {
                try {
                    // PostgreSQL arrays come as strings like '{1,2,3}' or as actual arrays
                    if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
                        // Convert PostgreSQL array format to JSON array format
                        const arrayContent = value.slice(1, -1);
                        if (arrayContent.trim() === '') {
                            formattedValue = '[]';
                        } else {
                            // Simple parsing - this could be enhanced for complex types
                            const items = arrayContent.split(',').map(item => {
                                const trimmed = item.trim();
                                // If it looks like a string (quoted), keep quotes
                                if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                                    return trimmed;
                                }
                                // If it's a number, keep as is
                                if (!isNaN(trimmed) && trimmed !== '') {
                                    return trimmed;
                                }
                                // Otherwise, quote it
                                return '"' + trimmed + '"';
                            });
                            formattedValue = '[' + items.join(', ') + ']';
                        }
                    } else if (Array.isArray(value)) {
                        formattedValue = JSON.stringify(value);
                    } else {
                        formattedValue = String(value);
                    }
                } catch (e) {
                    formattedValue = String(value);
                }
            }
            textarea.value = formattedValue;
            
            return textarea;
        }
        
        function createTextareaEditor(column, value) {
            const textarea = document.createElement('textarea');
            textarea.className = 'text-editor';
            textarea.rows = 3;
            textarea.value = value === null ? '' : String(value);
            
            if (column.maxLength) {
                textarea.maxLength = column.maxLength;
            }
            
            return textarea;
        }
        
        function createBooleanEditor(column, value) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = value === true || value === 't' || value === 'true' || value === '1';
            return checkbox;
        }
        
        function formatValueForInput(value, dataType) {
            if (value === null || value === undefined) {
                return '';
            }
            
            const type = dataType.toLowerCase();
            
            // Handle timestamp/datetime formatting
            if (type.includes('timestamp') || type.includes('datetime')) {
                try {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        // Format for datetime-local input (YYYY-MM-DDTHH:mm)
                        return date.toISOString().slice(0, 16);
                    }
                } catch (e) {
                    // Fall back to string representation
                }
            }
            
            // Handle date formatting
            if (type === 'date') {
                try {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        // Format for date input (YYYY-MM-DD)
                        return date.toISOString().slice(0, 10);
                    }
                } catch (e) {
                    // Fall back to string representation
                }
            }
            
            // Handle time formatting
            if (type === 'time' || type.includes('time without time zone')) {
                // PostgreSQL time format is usually HH:MM:SS, HTML time input expects HH:MM
                if (typeof value === 'string' && value.includes(':')) {
                    const parts = value.split(':');
                    if (parts.length >= 2) {
                        return parts[0] + ':' + parts[1];
                    }
                }
            }
            
            return String(value);
        }
        
        function addInputValidation(input, column) {
            const type = column.type.toLowerCase();
            
            // Add max length for character types
            if ((type.includes('character') || type.includes('varchar')) && column.maxLength) {
                input.maxLength = column.maxLength;
            }
            
            // Add step for numeric types
            if (type.includes('decimal') || type.includes('numeric')) {
                input.step = 'any';
            }
            
            // Add required attribute for non-nullable columns
            if (!column.nullable) {
                input.required = true;
            }
        }
        
        function getPlaceholderText(dataType) {
            const type = dataType.toLowerCase();
            
            if (type === 'json' || type === 'jsonb') {
                return 'Enter valid JSON, e.g., {"key": "value"}';
            }
            if (type.includes('[]') || type.includes('array')) {
                return 'Enter array, e.g., [1,2,3] or ["a","b","c"]';
            }
            if (type === 'uuid') {
                return 'Enter UUID, e.g., 123e4567-e89b-12d3-a456-426614174000';
            }
            if (type.includes('timestamp')) {
                return 'Enter timestamp, e.g., 2023-12-25 14:30:00';
            }
            if (type === 'date') {
                return 'Enter date, e.g., 2023-12-25';
            }
            if (type === 'time') {
                return 'Enter time, e.g., 14:30:00';
            }
            
            return '';
        }
        
        function addKeyboardNavigation(inputElement, cell, index) {
            // Special handling for textarea elements
            if (inputElement.tagName.toLowerCase() === 'textarea') {
                inputElement.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        cancelRowEdit(index);
                    } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const nextCell = e.shiftKey 
                            ? findPreviousEditableCell(cell)
                            : findNextEditableCell(cell);
                        if (nextCell) {
                            const nextInput = nextCell.cell.querySelector('.cell-editor');
                            if (nextInput) {
                                nextInput.focus();
                                if (nextInput.select) nextInput.select();
                            }
                        }
                    }
                    // For textareas, allow Enter for new lines, use Ctrl+Enter to move to next cell
                    else if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        const nextCell = findNextEditableCell(cell);
                        if (nextCell) {
                            const nextInput = nextCell.cell.querySelector('.cell-editor');
                            if (nextInput) {
                                nextInput.focus();
                                if (nextInput.select) nextInput.select();
                            }
                        } else {
                            saveRowEdit(index);
                        }
                    }
                });
            } else {
                // Standard input elements
                inputElement.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const nextCell = findNextEditableCell(cell);
                        if (nextCell) {
                            const nextInput = nextCell.cell.querySelector('.cell-editor');
                            if (nextInput) {
                                nextInput.focus();
                                if (nextInput.select) nextInput.select();
                            }
                        } else {
                            saveRowEdit(index);
                        }
                    } else if (e.key === 'Escape') {
                        cancelRowEdit(index);
                    } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const nextCell = e.shiftKey 
                            ? findPreviousEditableCell(cell)
                            : findNextEditableCell(cell);
                        if (nextCell) {
                            const nextInput = nextCell.cell.querySelector('.cell-editor');
                            if (nextInput) {
                                nextInput.focus();
                                if (nextInput.select) nextInput.select();
                            }
                        }
                    }
                });
            }
        }
        
        function extractValueFromInput(inputElement, column) {
            const type = column.type.toLowerCase();
            
            // Handle checkboxes
            if (inputElement.type === 'checkbox') {
                return inputElement.checked;
            }
            
            // Handle empty values
            if (inputElement.value.trim() === '') {
                return null;
            }
            
            const value = inputElement.value;
            
            // Handle JSON/JSONB
            if (type === 'json' || type === 'jsonb') {
                try {
                    // Validate JSON and return as string (PostgreSQL expects JSON as string)
                    JSON.parse(value);
                    return value;
                } catch (e) {
                    // If invalid JSON, return as-is and let the backend handle the error
                    return value;
                }
            }
            
            // Handle arrays
            if (type.includes('[]') || type.includes('array')) {
                try {
                    // Try to parse as JSON array first
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed)) {
                        // Convert to PostgreSQL array format
                        return '{' + parsed.map(item => {
                            if (typeof item === 'string') {
                                return '"' + item.replace(/"/g, '\\\\"') + '"';
                            }
                            return String(item);
                        }).join(',') + '}';
                    }
                } catch (e) {
                    // If not valid JSON, try to parse as simple comma-separated values
                    if (value.startsWith('[') && value.endsWith(']')) {
                        // Remove brackets and parse
                        const content = value.slice(1, -1);
                        return '{' + content + '}';
                    }
                }
                return value; // Return as-is if parsing fails
            }
            
            // Handle numeric types
            if (type.includes('int') || type.includes('serial') || 
                type.includes('numeric') || type.includes('decimal') || 
                type.includes('float') || type.includes('double') || type.includes('real')) {
                const numValue = parseFloat(value);
                return isNaN(numValue) ? value : numValue;
            }
            
            // Handle boolean (for text inputs that might contain boolean values)
            if (type.includes('bool') && inputElement.type !== 'checkbox') {
                const lowerValue = value.toLowerCase();
                if (lowerValue === 'true' || lowerValue === 't' || lowerValue === '1') {
                    return true;
                } else if (lowerValue === 'false' || lowerValue === 'f' || lowerValue === '0') {
                    return false;
                }
            }
            
            // For all other types, return the string value
            return value;
        }
        
        function addNewRowKeyboardNavigation(inputElement) {
            // Special handling for textarea elements
            if (inputElement.tagName.toLowerCase() === 'textarea') {
                inputElement.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelNewRow();
                    } else if (e.key === 'Enter' && e.ctrlKey) {
                        e.preventDefault();
                        saveNewRow();
                    }
                    // Tab navigation works naturally for textareas
                });
            } else {
                // Standard input elements
                inputElement.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        saveNewRow();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelNewRow();
                    }
                    // Tab navigation works naturally
                });
            }
        }
        
        function formatValueForDisplay(value, dataType) {
            const type = dataType.toLowerCase();
            const stringValue = String(value);
            
            // Handle JSON/JSONB
            if (type === 'json' || type === 'jsonb') {
                try {
                    // Try to parse and format JSON
                    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                    const formatted = JSON.stringify(parsed, null, 2);
                    
                    // Truncate for display if too long
                    const displayText = formatted.length > 100 
                        ? JSON.stringify(parsed).substring(0, 100) + '...'
                        : JSON.stringify(parsed);
                        
                    return {
                        text: displayText,
                        tooltip: formatted,
                        className: 'json-cell'
                    };
                } catch (e) {
                    return {
                        text: stringValue.length > 100 ? stringValue.substring(0, 100) + '...' : stringValue,
                        tooltip: stringValue,
                        className: 'json-cell invalid-json'
                    };
                }
            }
            
            // Handle Arrays
            if (type.includes('[]') || type.includes('array')) {
                let displayText = stringValue;
                
                // Convert PostgreSQL array format to more readable format
                if (stringValue.startsWith('{') && stringValue.endsWith('}')) {
                    displayText = '[' + stringValue.slice(1, -1) + ']';
                }
                
                return {
                    text: displayText.length > 100 ? displayText.substring(0, 100) + '...' : displayText,
                    tooltip: displayText,
                    className: 'array-cell'
                };
            }
            
            // Handle UUIDs
            if (type === 'uuid') {
                return {
                    text: stringValue,
                    tooltip: 'UUID: ' + stringValue,
                    className: 'uuid-cell'
                };
            }
            
            // Handle Boolean
            if (type.includes('bool')) {
                const boolValue = value === true || value === 't' || value === 'true' || value === '1';
                return {
                    text: boolValue ? 'true' : 'false',
                    tooltip: 'Boolean: ' + (boolValue ? 'true' : 'false'),
                    className: boolValue ? 'bool-cell bool-true' : 'bool-cell bool-false'
                };
            }
            
            // Handle Timestamps and Dates
            if (type.includes('timestamp') || type === 'date' || type.includes('time')) {
                try {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        let displayText;
                        if (type === 'date') {
                            displayText = date.toISOString().split('T')[0];
                        } else if (type.includes('time') && !type.includes('timestamp')) {
                            displayText = stringValue; // Keep original time format
                        } else {
                            displayText = date.toLocaleString();
                        }
                        
                        return {
                            text: displayText,
                            tooltip: 'Date/Time: ' + date.toISOString(),
                            className: 'datetime-cell'
                        };
                    }
                } catch (e) {
                    // Fall through to default handling
                }
            }
            
            // Handle Numeric types
            if (type.includes('int') || type.includes('serial') || 
                type.includes('numeric') || type.includes('decimal') || 
                type.includes('float') || type.includes('double') || type.includes('real')) {
                return {
                    text: stringValue,
                    tooltip: 'Number: ' + stringValue,
                    className: 'numeric-cell'
                };
            }
            
            // Handle Long Text
            if (type === 'text' || (type.includes('character varying') && stringValue.length > 50)) {
                return {
                    text: stringValue.length > 100 ? stringValue.substring(0, 100) + '...' : stringValue,
                    tooltip: stringValue,
                    className: 'text-cell'
                };
            }
            
            // Default handling for other types
            return {
                text: stringValue.length > 200 ? stringValue.substring(0, 200) + '...' : stringValue,
                tooltip: stringValue,
                className: null
            };
        }
        
        function loadPage(page) {
            vscode.postMessage({
                command: 'loadPage',
                page: page
            });
        }
        
        function refresh() {
            vscode.postMessage({
                command: 'refresh'
            });
        }
        
        function openNeonConsole() {
            vscode.postMessage({
                command: 'openNeonConsole'
            });
        }
        
        function updatePagination() {
            if (!currentData) return;
            
            const hasPages = currentData.totalCount > pageSize;
            pagination.style.display = hasPages ? 'flex' : 'none';
            
            if (hasPages) {
                const totalPages = Math.ceil(currentData.totalCount / pageSize);
                pageInfo.textContent = \`Page \${currentPage + 1} of \${totalPages}\`;
                prevPageBtn.disabled = currentPage === 0;
                nextPageBtn.disabled = !currentData.hasMore;
            }
        }
        
        function updateStatus(text) {
            statusText.textContent = text;
        }
        
        function changeLimitSize() {
            const newLimit = parseInt(limitSelect.value);
            pageSize = newLimit;
            
            vscode.postMessage({
                command: 'changeLimitSize',
                limit: newLimit
            });
        }
        
        function showErrorMessage(message) {
            // Use the confirm dialog to show error messages
            confirmMessage.textContent = message;
            confirmDelete.style.display = 'none';
            confirmCancel.textContent = 'OK';
            confirmDialog.style.display = 'block';
            
            // Reset the dialog when closed
            const resetDialog = () => {
                confirmDelete.style.display = 'inline-block';
                confirmCancel.textContent = 'Cancel';
                confirmCancel.removeEventListener('click', resetDialog);
            };
            confirmCancel.addEventListener('click', resetDialog);
        }
        
        function applyFilter() {
            const filterValue = filterInput.value.toLowerCase().trim();
            
            if (!filterValue) {
                filteredData = [...currentData.rows];
            } else {
                filteredData = currentData.rows.filter(row => {
                    return visibleColumns.some(colName => {
                        const value = row[colName];
                        const searchText = value === null ? 'null' : String(value).toLowerCase();
                        return searchText.includes(filterValue);
                    });
                });
            }
            
            // Re-apply sorting if active
            if (sortColumn) {
                applySorting();
            }
            
            displayTable(currentData);
            updateStatus(\`Showing \${filteredData.length} of \${currentData.totalCount} rows\`);
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
            displayTable(currentData);
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
            
            originalColumns.forEach(colName => {
                const item = document.createElement('div');
                item.className = 'column-visibility-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = visibleColumns.includes(colName);
                checkbox.addEventListener('change', () => toggleColumn(colName));
                
                const label = document.createElement('span');
                label.textContent = colName;
                
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
            
            displayTable(currentData);
        }
    </script>
</body>
</html>`;
    }

    private getKey(): string {
        return `${this.database || 'default'}.${this.schema}.${this.tableName}`;
    }

    public dispose() {
        const key = this.getKey();
        TableDataPanel.currentPanels.delete(key);

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}