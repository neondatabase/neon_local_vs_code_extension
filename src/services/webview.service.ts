import * as vscode from 'vscode';
import { VIEW_TYPES } from '../constants';
import { ViewData } from '../types';
import { StateService } from './state.service';
import axios from 'axios';
import { Logger, ConfigurationManager } from '../utils';

export class WebViewService {
    private panels: Map<string, vscode.WebviewPanel> = new Map();
    private views: Map<string, vscode.Webview> = new Map();
    private viewDisposables: Map<string, vscode.Disposable[]> = new Map();
    private lastViewData: Map<string, ViewData> = new Map();
    private readonly stateService: StateService;
    private context: vscode.ExtensionContext;
    private messagePostingStats = {
        successful: 0,
        failed: 0,
        lastFailureTime: 0,
        lastFailureReason: ''
    };

    constructor(context: vscode.ExtensionContext, stateService: StateService) {
        this.context = context;
        this.stateService = stateService;
        console.debug('WebViewService: Initialized with context');
    }

    public async initialize(): Promise<void> {
        console.debug('WebViewService: Initializing service');
        // Initialize with empty state
        await this.updateAllViews();
        console.debug('WebViewService: Service initialization complete');
    }

    public registerPanel(panel: vscode.WebviewPanel, panelId?: string): string {
        const id = panelId || `panel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.debug(`WebViewService: Registering panel with ID: ${id}`);
        
        this.panels.set(id, panel);
        const disposables: vscode.Disposable[] = [];
        
        // Remove panel from registry when it's disposed
        const disposeHandler = panel.onDidDispose(() => {
            console.debug(`WebViewService: Panel ${id} disposed, cleaning up`);
            this.panels.delete(id);
            
            // Clean up all disposables for this panel
            const panelDisposables = this.viewDisposables.get(id);
            if (panelDisposables) {
                panelDisposables.forEach(d => {
                    try {
                        d.dispose();
                    } catch (error) {
                        console.error(`WebViewService: Error disposing panel ${id} resource:`, error);
                    }
                });
                this.viewDisposables.delete(id);
            }
        });
        
        disposables.push(disposeHandler);
        this.viewDisposables.set(id, disposables);

        // Setup the webview
        this.setupWebview(panel.webview);
        
        console.debug(`WebViewService: Panel ${id} registered successfully. Total panels: ${this.panels.size}`);
        return id;
    }

    public registerWebview(webview: vscode.Webview, viewId?: string): string {
        const id = viewId || `view_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.debug(`WebViewService: Registering webview with ID: ${id}`);
        
        this.views.set(id, webview);
        this.setupWebview(webview);
        
        console.debug(`WebViewService: Webview ${id} registered successfully. Total views: ${this.views.size}`);
        return id;
    }

    public unregisterWebview(webviewId: string): boolean {
        console.debug(`WebViewService: Unregistering webview with ID: ${webviewId}`);
        
        const removed = this.views.delete(webviewId);
        if (removed) {
            // Clean up any disposables associated with this view
            const viewDisposables = this.viewDisposables.get(webviewId);
            if (viewDisposables) {
                viewDisposables.forEach(d => {
                    try {
                        d.dispose();
                    } catch (error) {
                        console.error(`WebViewService: Error disposing view ${webviewId} resource:`, error);
                    }
                });
                this.viewDisposables.delete(webviewId);
            }
            console.debug(`WebViewService: Webview ${webviewId} unregistered successfully. Total views: ${this.views.size}`);
        } else {
            console.warn(`WebViewService: Attempted to unregister non-existent webview: ${webviewId}`);
        }
        
        return removed;
    }

    private setupWebview(webview: vscode.Webview) {
        console.debug('WebViewService: Setting up webview options');
        webview.options = {
            enableScripts: true,
            enableCommandUris: false,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'dist')
            ]
        };
    }

    public postMessageToAll(message: any): void {
        const timestamp = Date.now();
        const messageType = message.command || 'unknown';
        console.debug(`WebViewService: Broadcasting message '${messageType}' to ${this.panels.size} panels and ${this.views.size} views`);
        
        let successCount = 0;
        let failureCount = 0;
        const failures: string[] = [];

        // Post to all panels
        for (const [panelId, panel] of this.panels) {
            try {
                panel.webview.postMessage(message);
                successCount++;
                console.debug(`WebViewService: Successfully posted message to panel ${panelId}`);
            } catch (err) {
                failureCount++;
                const errorMsg = err instanceof Error ? err.message : String(err);
                failures.push(`Panel ${panelId}: ${errorMsg}`);
                console.error(`WebViewService: Failed to post message to panel ${panelId}:`, err);
                
                // Remove panel if it's no longer valid
                console.debug(`WebViewService: Removing invalid panel ${panelId}`);
                this.panels.delete(panelId);
                
                // Clean up disposables
                const disposables = this.viewDisposables.get(panelId);
                if (disposables) {
                    disposables.forEach(d => {
                        try {
                            d.dispose();
                        } catch (disposeError) {
                            console.error(`WebViewService: Error disposing panel ${panelId} resources:`, disposeError);
                        }
                    });
                    this.viewDisposables.delete(panelId);
                }
            }
        }

        // Post to all views
        for (const [viewId, view] of this.views) {
            try {
                view.postMessage(message);
                successCount++;
                console.debug(`WebViewService: Successfully posted message to view ${viewId}`);
            } catch (err) {
                failureCount++;
                const errorMsg = err instanceof Error ? err.message : String(err);
                failures.push(`View ${viewId}: ${errorMsg}`);
                console.error(`WebViewService: Failed to post message to view ${viewId}:`, err);
                
                // Remove view if it's no longer valid
                console.debug(`WebViewService: Removing invalid view ${viewId}`);
                this.views.delete(viewId);
                
                // Clean up disposables
                const disposables = this.viewDisposables.get(viewId);
                if (disposables) {
                    disposables.forEach(d => {
                        try {
                            d.dispose();
                        } catch (disposeError) {
                            console.error(`WebViewService: Error disposing view ${viewId} resources:`, disposeError);
                        }
                    });
                    this.viewDisposables.delete(viewId);
                }
            }
        }

        // Update statistics
        this.messagePostingStats.successful += successCount;
        this.messagePostingStats.failed += failureCount;
        
        if (failureCount > 0) {
            this.messagePostingStats.lastFailureTime = timestamp;
            this.messagePostingStats.lastFailureReason = failures.join('; ');
        }

        console.debug(`WebViewService: Message broadcast complete. Success: ${successCount}, Failures: ${failureCount}`);
        
        if (failures.length > 0) {
            console.error(`WebViewService: Message posting failures:`, failures);
        }
    }

    public updateViewData(viewType: string, data: ViewData): void {
        console.debug(`WebViewService: Updating view ${viewType} with data:`, {
            connected: data.connected,
            isStarting: data.isStarting,
            connectionType: data.connectionType,
            selectedBranchId: data.selectedBranchId,
            currentlyConnectedBranch: data.currentlyConnectedBranch,
            databases: data.databases?.length,
            roles: data.roles?.length,
            isExplicitUpdate: data.isExplicitUpdate,
            timestamp: new Date().toISOString()
        });
        
        // Store the latest data
        this.lastViewData.set(viewType, data);
        
        // Send to all views
        this.postMessageToAll({ command: 'updateViewData', data });
        console.debug(`WebViewService: View data sent to ${viewType}. Active panels: ${this.panels.size}, Active views: ${this.views.size}`);
    }

    public getRegistrationStats() {
        return {
            panels: this.panels.size,
            views: this.views.size,
            messageStats: { ...this.messagePostingStats }
        };
    }

    public showPanel(context: vscode.ExtensionContext): void {
        console.debug('WebViewService: Creating new webview panel');
        const panel = vscode.window.createWebviewPanel(
            'neonLocal',
            'Neon - Serverless Postgres',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                enableCommandUris: false,
                localResourceRoots: [context.extensionUri]
            }
        );

        panel.webview.html = this.getWebviewContent();
        
        // Register the panel
        const panelId = this.registerPanel(panel);
        console.debug(`WebViewService: Panel created and registered with ID: ${panelId}`);
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neon - Serverless Postgres</title>
            </head>
            <body>
                <h1>Neon - Serverless Postgres</h1>
                <p>Please use the Neon - Serverless Postgres view in the Activity Bar.</p>
            </body>
            </html>`;
    }

    public async handleDatabaseSelection(database: string) {
        console.debug(`WebViewService: Handling database selection: ${database}`);
        await this.stateService.updateDatabase(database);
        await this.updateAllViews();
    }

    public async handleRoleSelection(role: string) {
        console.debug(`WebViewService: Handling role selection: ${role}`);
        await this.stateService.updateRole(role);
        await this.updateAllViews();
    }

    public async getViewData(): Promise<ViewData> {
        return this.stateService.getViewData();
    }

    private async updateAllViews() {
        console.debug('WebViewService: Updating all views with current state');
        const viewData = await this.getViewData();
        this.updateViewData('neonLocal', viewData);
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private getScriptUri(): string {
        // Implement the logic to get the script URI based on the context
        // This is a placeholder and should be replaced with the actual implementation
        return '';
    }

    public async configure(): Promise<void> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Neon API Key',
            password: true,
            ignoreFocusOut: true
        });

        if (apiKey) {
            await ConfigurationManager.updateSecureToken(this.context, 'apiKey', apiKey);
            await this.showPanel(this.context);
        }
    }

    public async getNeonApiClient() {
        const apiKey = await ConfigurationManager.getSecureToken(this.context, 'apiKey');
        
        if (!apiKey) {
            throw new Error('Neon API key not configured');
        }

        return axios.create({
            baseURL: 'https://console.neon.tech/api/v2',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
    }

    public async updateWebview(webview: vscode.WebviewView, viewData: ViewData): Promise<void> {
        try {
            console.debug('WebViewService: Sending updateViewData message to specific webview');
            await webview.webview.postMessage({
                command: 'updateViewData',
                data: viewData
            });
            console.debug('WebViewService: Specific webview update complete');
        } catch (error) {
            console.error('WebViewService: Error updating specific webview:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Webview update error: ${error.message}`);
            }
        }
    }

    public dispose(): void {
        console.debug('WebViewService: Disposing service and cleaning up resources');
        
        // Clean up all disposables
        for (const [id, disposables] of this.viewDisposables) {
            console.debug(`WebViewService: Cleaning up disposables for ${id}`);
            disposables.forEach(d => {
                try {
                    d.dispose();
                } catch (error) {
                    console.error(`WebViewService: Error disposing resource for ${id}:`, error);
                }
            });
        }
        
        // Clear all maps
        this.panels.clear();
        this.views.clear();
        this.viewDisposables.clear();
        this.lastViewData.clear();
        
        console.debug('WebViewService: Service disposal complete');
    }
} 