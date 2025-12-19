import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class MCPServerViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'neonLocalMcpServer';
    private _view?: vscode.WebviewView;
    private readonly _extensionUri: vscode.Uri;
    private readonly _isCursor: boolean;
    private readonly _context: vscode.ExtensionContext;
    private static readonly AUTO_CONFIG_ENABLED_KEY = 'neon.mcpServer.autoConfigEnabled';
    
    // Expected Neon MCP server configuration (HTTP format)
    private static readonly EXPECTED_NEON_CONFIG = {
        type: 'http',
        url: 'https://mcp.neon.tech/mcp'
    };

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._context = context;
        // Detect if running in Cursor
        this._isCursor = vscode.env.appName.toLowerCase().includes('cursor');
    }

    /**
     * Find a Neon server key in the servers object (case-insensitive)
     * Returns the actual key name if found, null otherwise
     */
    private findNeonServerKey(servers: Record<string, any> | undefined): string | null {
        if (!servers) {
            return null;
        }
        
        for (const key of Object.keys(servers)) {
            if (key.toLowerCase() === 'neon') {
                return key;
            }
        }
        return null;
    }

    /**
     * Check if a Neon server configuration matches what the extension would configure
     */
    private isExtensionManagedConfig(serverConfig: any): boolean {
        if (!serverConfig) {
            return false;
        }
        
        // Check if it's an HTTP-based config pointing to our expected URL
        const isHttpType = serverConfig.type === 'http';
        const hasExpectedUrl = serverConfig.url === MCPServerViewProvider.EXPECTED_NEON_CONFIG.url;
        
        // Check if the config has an Authorization header with a Bearer token
        const authHeader = serverConfig.headers?.Authorization;
        const hasBearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') && authHeader.length > 7;
        
        // Check if the token starts with 'napi_' (Neon API token format)
        const token = hasBearerToken ? authHeader.substring(7) : '';
        const hasNeonApiToken = token.startsWith('napi_');
        
        return isHttpType && hasExpectedUrl && hasBearerToken && hasNeonApiToken;
    }

    /**
     * Check if auto-configuration is enabled
     */
    private async isAutoConfigEnabled(): Promise<boolean> {
        // Default to true (enabled) if not set
        const enabled = this._context.globalState.get<boolean>(
            MCPServerViewProvider.AUTO_CONFIG_ENABLED_KEY,
            true
        );
        return enabled;
    }

    /**
     * Set auto-configuration enabled/disabled state
     */
    private async setAutoConfigEnabled(enabled: boolean): Promise<void> {
        await this._context.globalState.update(
            MCPServerViewProvider.AUTO_CONFIG_ENABLED_KEY,
            enabled
        );
        console.log('[MCP Server] Auto-configuration', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Check if MCP server is configured (public method for external use)
     */
    public async isConfigured(): Promise<boolean> {
        const config = await this.getMcpConfiguration();
        return config.isConfigured;
    }

    /**
     * Automatically configure MCP server if not already configured (public method for external use)
     */
    public async autoConfigureIfNeeded(): Promise<void> {
        try {
            // Check if auto-configuration is enabled
            const autoConfigEnabled = await this.isAutoConfigEnabled();
            if (!autoConfigEnabled) {
                console.log('[MCP Server] Auto-configuration is disabled, skipping');
                return;
            }

            const config = await this.getMcpConfiguration();
            if (config.isConfigured) {
                if (config.isManaged) {
                    console.log('[MCP Server] Already configured with managed config, skipping auto-configuration');
                } else {
                    console.log('[MCP Server] Non-managed Neon MCP server detected, skipping auto-configuration');
                }
                return;
            }

            console.log('[MCP Server] Not configured, attempting auto-configuration...');
            
            // Both Cursor and VS Code require the API token (HTTP format)
            const apiToken = await this._context.secrets.get('neon.persistentApiToken');
            if (!apiToken) {
                console.log('[MCP Server] Auto-configuration skipped: User not signed in (no API token)');
                return;
            }

            // Auto-install to user settings
            await this.installToMcpJson('user');
            console.log('[MCP Server] Auto-configuration completed successfully');

            // Refresh the view to show configured status
            await this.refreshView();

            // Optionally notify user (silent notification, doesn't interrupt workflow)
            const appName = this._isCursor ? 'Cursor' : 'VS Code';
            vscode.window.showInformationMessage(
                `Neon MCP Server has been automatically configured in ${appName}. Reload the window to enable AI chat features.`,
                'Reload Now',
                'Later'
            ).then(selection => {
                if (selection === 'Reload Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            console.error('[MCP Server] Auto-configuration failed:', error);
            // Don't show error to user - this is a silent operation
        }
    }

    /**
     * Configure MCP server from button click in webview
     */
    private async configureFromButton(): Promise<void> {
        try {
            console.log('[MCP Server] Configuring from button click...');
            
            // Check for API token
            const apiToken = await this._context.secrets.get('neon.persistentApiToken');
            if (!apiToken) {
                vscode.window.showWarningMessage(
                    'Please sign in to the Neon extension before configuring the MCP server.',
                    'Sign In'
                ).then(selection => {
                    if (selection === 'Sign In') {
                        vscode.commands.executeCommand('neonLocal.signIn');
                    }
                });
                
                if (this._view) {
                    this._view.webview.postMessage({ command: 'configurationFailed' });
                }
                return;
            }
            
            // Install to user settings
            await this.installToMcpJson('user');
            console.log('[MCP Server] Configuration from button completed successfully');
            
            const appName = this._isCursor ? 'Cursor' : 'VS Code';
            vscode.window.showInformationMessage(
                `Neon MCP Server configured successfully in ${appName}!`,
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
            
            // Notify webview of success and refresh
            if (this._view) {
                this._view.webview.postMessage({ command: 'configurationComplete' });
            }
        } catch (error) {
            console.error('[MCP Server] Configuration from button failed:', error);
            vscode.window.showErrorMessage(
                `Failed to configure MCP Server: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            if (this._view) {
                this._view.webview.postMessage({ command: 'configurationFailed' });
            }
        }
    }

    /**
     * Re-configure MCP server when a non-managed configuration is detected
     * This will remove the existing configuration and install a new managed one
     */
    private async reconfigureMcpServer(): Promise<void> {
        try {
            console.log('[MCP Server] Re-configuring MCP server...');
            
            // Check for API token
            const apiToken = await this._context.secrets.get('neon.persistentApiToken');
            if (!apiToken) {
                vscode.window.showWarningMessage(
                    'Please sign in to the Neon extension before re-configuring the MCP server.',
                    'Sign In'
                ).then(selection => {
                    if (selection === 'Sign In') {
                        vscode.commands.executeCommand('neonLocal.signIn');
                    }
                });
                
                if (this._view) {
                    this._view.webview.postMessage({ command: 'configurationFailed' });
                }
                return;
            }
            
            // Show confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                'This will replace the existing Neon MCP server configuration with the extension-managed configuration. Continue?',
                { modal: true },
                'Re-configure',
                'Cancel'
            );
            
            if (confirmation !== 'Re-configure') {
                if (this._view) {
                    this._view.webview.postMessage({ command: 'configurationFailed' });
                }
                return;
            }
            
            // Remove existing configuration first
            await this.removeMcpConfiguration();
            
            // Install new managed configuration
            await this.installToMcpJson('user');
            console.log('[MCP Server] Re-configuration completed successfully');
            
            const appName = this._isCursor ? 'Cursor' : 'VS Code';
            vscode.window.showInformationMessage(
                `Neon MCP Server re-configured successfully in ${appName}!`,
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
            
            // Notify webview of success and refresh
            if (this._view) {
                this._view.webview.postMessage({ command: 'configurationComplete' });
            }
        } catch (error) {
            console.error('[MCP Server] Re-configuration failed:', error);
            vscode.window.showErrorMessage(
                `Failed to re-configure MCP Server: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            
            if (this._view) {
                this._view.webview.postMessage({ command: 'configurationFailed' });
            }
        }
    }

    /**
     * Enable MCP server (public method for command)
     */
    public async enableMcpServer(): Promise<void> {
        await this.setAutoConfigEnabled(true);
        await this.updateContextVariable(true);
        
        vscode.window.showInformationMessage('MCP server enabled');
        
        // Auto-configure if not already configured
        const isConfigured = await this.isConfigured();
        if (!isConfigured) {
            await this.autoConfigureIfNeeded();
        }
        
        // Refresh the view
        await this.refreshView();
    }

    /**
     * Disable MCP server (public method for command)
     */
    public async disableMcpServer(): Promise<void> {
        // Show confirmation dialog
        const confirmation = await vscode.window.showWarningMessage(
            'Are you sure you want to disable the Neon MCP server? This will remove the MCP configuration and disable AI chat features for Neon.',
            { modal: true },
            'Disable',
            'Cancel'
        );
        
        if (confirmation !== 'Disable') {
            return;
        }
        
        try {
            await this.setAutoConfigEnabled(false);
            await this.updateContextVariable(false);
            
            // Remove MCP configuration from mcp.json
            await this.removeMcpConfiguration();
            
            vscode.window.showInformationMessage(
                'MCP server disabled and configuration removed',
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
            
            // Refresh the view
            await this.refreshView();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to disable MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Update VS Code context variable for showing appropriate command
     */
    private async updateContextVariable(enabled: boolean): Promise<void> {
        await vscode.commands.executeCommand('setContext', 'neonLocal.mcpServer.autoConfigEnabled', enabled);
    }

    /**
     * Remove Neon MCP server configuration from mcp.json files
     */
    private async removeMcpConfiguration(): Promise<void> {
        // Remove from user config
        const userMcpPath = this.getMcpJsonPath();
        await this.removeMcpFromFile(userMcpPath, 'user');

        // Remove from workspace config if it exists
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceMcpPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'mcp.json');
            if (fs.existsSync(workspaceMcpPath)) {
                await this.removeMcpFromFile(workspaceMcpPath, 'workspace');
            }
        }
    }

    /**
     * Remove Neon MCP server from a specific mcp.json file (case-insensitive)
     */
    private async removeMcpFromFile(mcpPath: string, scope: 'user' | 'workspace'): Promise<void> {
        try {
            if (!fs.existsSync(mcpPath)) {
                console.log(`[MCP Server] No mcp.json found at ${mcpPath}, skipping removal`);
                return;
            }

            const mcpContent = fs.readFileSync(mcpPath, 'utf8');
            if (!mcpContent.trim()) {
                console.log(`[MCP Server] Empty mcp.json at ${mcpPath}, skipping removal`);
                return;
            }

            const mcpConfig = JSON.parse(mcpContent);
            
            // Remove Neon from mcpServers (case-insensitive)
            if (mcpConfig.mcpServers) {
                const neonKey = this.findNeonServerKey(mcpConfig.mcpServers);
                if (neonKey) {
                    delete mcpConfig.mcpServers[neonKey];
                    console.log(`[MCP Server] Removed '${neonKey}' from mcpServers at ${mcpPath}`);
                }
            }
            
            // Remove Neon from servers (case-insensitive)
            if (mcpConfig.servers) {
                const neonKey = this.findNeonServerKey(mcpConfig.servers);
                if (neonKey) {
                    delete mcpConfig.servers[neonKey];
                    console.log(`[MCP Server] Removed '${neonKey}' from servers at ${mcpPath}`);
                }
            }
            
            // Also check for legacy formats and clean them up
            if (mcpConfig.servers && mcpConfig.servers['neon-local']) {
                delete mcpConfig.servers['neon-local'];
                console.log(`[MCP Server] Removed legacy neon-local from servers at ${mcpPath}`);
            }

            // Write back to file
            fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2), 'utf8');
            console.log(`[MCP Server] Successfully updated ${scope} mcp.json`);
        } catch (error) {
            console.error(`[MCP Server] Failed to remove from ${scope} mcp.json:`, error);
            throw new Error(`Failed to remove MCP configuration from ${scope} settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Refresh the view (public method for command)
     */
    public async refreshView(): Promise<void> {
        await this.checkConfiguration();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        console.log('[MCP Server] resolveWebviewView called');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getWebviewContent();
        console.log('[MCP Server] Webview HTML set');

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            console.log('[MCP Server] Received message from webview:', message.command);
            switch (message.command) {
                case 'checkConfiguration':
                    console.log('[MCP Server] Handling checkConfiguration message');
                    await this.checkConfiguration();
                    break;
                case 'installMcpServer':
                    console.log('[MCP Server] Handling installMcpServer message');
                    await this.installMcpServer(message.scope);
                    break;
                case 'configureMcpServer':
                    console.log('[MCP Server] Handling configureMcpServer message');
                    await this.configureFromButton();
                    break;
                case 'reconfigureMcpServer':
                    console.log('[MCP Server] Handling reconfigureMcpServer message');
                    await this.reconfigureMcpServer();
                    break;
                case 'openSettings':
                    console.log('[MCP Server] Handling openSettings message');
                    await this.openSettings(message.scope);
                    break;
                case 'openMcpConfigFile':
                    console.log('[MCP Server] Handling openMcpConfigFile message');
                    await this.openMcpConfigFile();
                    break;
            }
        });

        // Re-check configuration when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            console.log('[MCP Server] Visibility changed, visible:', webviewView.visible);
            if (webviewView.visible) {
                // Re-send IDE info
                webviewView.webview.postMessage({
                    command: 'ideInfo',
                    isCursor: this._isCursor,
                    appName: this._isCursor ? 'Cursor' : 'VS Code'
                });
                // Check configuration
                this.checkConfiguration();
            }
        });

        // Send IDE info to webview after a small delay to ensure it's ready
        setTimeout(() => {
            console.log('[MCP Server] Sending IDE info to webview');
            webviewView.webview.postMessage({
                command: 'ideInfo',
                isCursor: this._isCursor,
                appName: this._isCursor ? 'Cursor' : 'VS Code'
            });
            
            // Initial configuration check
            console.log('[MCP Server] Triggering initial configuration check');
            this.checkConfiguration();
        }, 100);
    }

    private async checkConfiguration(): Promise<void> {
        if (!this._view) {
            return;
        }

        const config = await this.getMcpConfiguration();
        const autoConfigEnabled = await this.isAutoConfigEnabled();
        
        // Update context variable for showing appropriate command in title bar
        await this.updateContextVariable(autoConfigEnabled);
        
        // Log configuration check results for debugging
        console.log('[MCP Server] Configuration check:', {
            isCursor: this._isCursor,
            isConfigured: config.isConfigured,
            isManaged: config.isManaged,
            configScope: config.configScope,
            autoConfigEnabled
        });
        
        this._view.webview.postMessage({
            command: 'configurationStatus',
            ...config,
            autoConfigEnabled,
            isCursor: this._isCursor,
            appName: this._isCursor ? 'Cursor' : 'VS Code'
        });
    }

    private async getMcpConfiguration(): Promise<{
        isConfigured: boolean;
        isManaged: boolean;
        configScope: 'user' | 'workspace' | null;
        configPath: string | null;
    }> {
        // Both Cursor and VS Code use mcp.json with the same format:
        // { "mcpServers": { "Neon": { ... } } }
        return this.checkMcpJsonConfiguration();
    }

    private async checkMcpJsonConfiguration(): Promise<{
        isConfigured: boolean;
        isManaged: boolean;
        configScope: 'user' | 'workspace' | null;
        configPath: string | null;
    }> {
        // Check workspace .vscode/mcp.json first
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceMcpPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'mcp.json');
            console.log('[MCP Server] Checking workspace mcp.json:', workspaceMcpPath);
            try {
                // Check if file exists before reading
                const fileExists = fs.existsSync(workspaceMcpPath);
                console.log('[MCP Server] Workspace mcp.json exists:', fileExists);
                if (fileExists) {
                    const mcpContent = fs.readFileSync(workspaceMcpPath, 'utf8');
                    if (mcpContent.trim()) {
                        const mcpConfig = JSON.parse(mcpContent);
                        console.log('[MCP Server] Workspace mcp.json content:', JSON.stringify(mcpConfig, null, 2));
                        // Cursor uses mcpServers, VS Code uses servers - check case-insensitively
                        const serversObj = this._isCursor ? mcpConfig?.mcpServers : mcpConfig?.servers;
                        const neonKey = this.findNeonServerKey(serversObj);
                        const hasNeonServer = neonKey !== null;
                        console.log(`[MCP Server] Workspace has Neon MCP server:`, hasNeonServer, 'key:', neonKey);
                        if (hasNeonServer) {
                            const serverConfig = serversObj[neonKey];
                            const isManaged = this.isExtensionManagedConfig(serverConfig);
                            console.log(`[MCP Server] Workspace Neon config is managed:`, isManaged);
                            return {
                                isConfigured: true,
                                isManaged,
                                configScope: 'workspace',
                                configPath: workspaceMcpPath
                            };
                        }
                    }
                }
            } catch (error) {
                console.warn('[MCP Server] Failed to read workspace mcp.json:', error);
            }
        }

        // Check user mcp.json
        const userMcpPath = this.getMcpJsonPath();
        console.log('[MCP Server] Checking user mcp.json:', userMcpPath);
        try {
            // Check if file exists before reading
            const fileExists = fs.existsSync(userMcpPath);
            console.log('[MCP Server] User mcp.json exists:', fileExists);
            if (fileExists) {
                const mcpContent = fs.readFileSync(userMcpPath, 'utf8');
                if (mcpContent.trim()) {
                    const mcpConfig = JSON.parse(mcpContent);
                    console.log('[MCP Server] User mcp.json content:', JSON.stringify(mcpConfig, null, 2));
                    // Cursor uses mcpServers, VS Code uses servers - check case-insensitively
                    const serversObj = this._isCursor ? mcpConfig?.mcpServers : mcpConfig?.servers;
                    const neonKey = this.findNeonServerKey(serversObj);
                    const hasNeonServer = neonKey !== null;
                    console.log(`[MCP Server] User mcp.json has Neon MCP server:`, hasNeonServer, 'key:', neonKey);
                    if (hasNeonServer) {
                        const serverConfig = serversObj[neonKey];
                        const isManaged = this.isExtensionManagedConfig(serverConfig);
                        console.log(`[MCP Server] User Neon config is managed:`, isManaged);
                        return {
                            isConfigured: true,
                            isManaged,
                            configScope: 'user',
                            configPath: userMcpPath
                        };
                    }
                }
            }
        } catch (error) {
            console.warn('[MCP Server] Failed to read user mcp.json:', error);
        }

        console.log('[MCP Server] No configuration found in mcp.json files');
        return {
            isConfigured: false,
            isManaged: false,
            configScope: null,
            configPath: null
        };
    }


    private getMcpJsonPath(): string {
        const homeDir = os.homedir();
        
        if (this._isCursor) {
            // Cursor uses ~/.cursor/mcp.json on all platforms
            return path.join(homeDir, '.cursor', 'mcp.json');
        } else {
            // VS Code uses the platform-specific User settings path
            const platform = os.platform();
            if (platform === 'win32') {
                return path.join(homeDir, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json');
            } else if (platform === 'darwin') {
                return path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
            } else {
                return path.join(homeDir, '.config', 'Code', 'User', 'mcp.json');
            }
        }
    }

    private async installMcpServer(scope: 'user' | 'workspace'): Promise<void> {
        try {
            // Both Cursor and VS Code require the API token (HTTP format)
            const apiToken = await this._context.secrets.get('neon.persistentApiToken');
            if (!apiToken) {
                vscode.window.showWarningMessage(
                    'Please sign in to the Neon extension before configuring the MCP server.',
                    'Sign In'
                ).then(selection => {
                    if (selection === 'Sign In') {
                        vscode.commands.executeCommand('neonLocal.signIn');
                    }
                });
                return;
            }

            // Both Cursor and VS Code use mcp.json
            await this.installToMcpJson(scope);

            const appName = this._isCursor ? 'Cursor' : 'VS Code';
            vscode.window.showInformationMessage(
                `Neon MCP Server configured successfully in ${appName} ${scope} settings!`,
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });

            // Refresh the view
            await this.checkConfiguration();
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to install MCP Server: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    private async installToMcpJson(scope: 'user' | 'workspace'): Promise<void> {
        let mcpPath: string;
        
        if (scope === 'user') {
            mcpPath = this.getMcpJsonPath();
            // Ensure parent directory exists (e.g., ~/.cursor or .../globalStorage)
            const parentDir = path.dirname(mcpPath);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }
        } else {
            // Workspace mcp.json
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace folder open');
            }
            mcpPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'mcp.json');
            
            // Ensure .vscode directory exists
            const vscodeDirPath = path.dirname(mcpPath);
            if (!fs.existsSync(vscodeDirPath)) {
                fs.mkdirSync(vscodeDirPath, { recursive: true });
            }
        }

        // Read existing mcp.json or create empty object
        let mcpConfig: any;
        if (fs.existsSync(mcpPath)) {
            try {
                const mcpContent = fs.readFileSync(mcpPath, 'utf8');
                mcpConfig = JSON.parse(mcpContent);
            } catch (parseError) {
                console.warn('[MCP Server] Failed to parse existing mcp.json, will create new:', parseError);
                mcpConfig = null;
            }
        }
        
        if (!mcpConfig) {
            mcpConfig = {};
        }

        // Get API token from secure storage
        let apiToken: string | undefined;
        try {
            apiToken = await this._context.secrets.get('neon.persistentApiToken');
            console.log('[MCP Server] API token retrieved:', !!apiToken);
        } catch (error) {
            console.warn('[MCP Server] Failed to get API token:', error);
        }

        if (!apiToken) {
            throw new Error('No API token found. Please sign in to the extension first.');
        }

        // Cursor uses "mcpServers", VS Code uses "servers"
        const serverKey = this._isCursor ? 'mcpServers' : 'servers';
        
        if (!mcpConfig[serverKey]) {
            mcpConfig[serverKey] = {};
        }
        
        mcpConfig[serverKey]['Neon'] = {
            type: 'http',
            url: 'https://mcp.neon.tech/mcp',
            headers: {
                Authorization: `Bearer ${apiToken}`
            }
        };

        // Write mcp.json back to file with pretty formatting
        console.log('[MCP Server] Writing mcp.json:', mcpPath);
        console.log('[MCP Server] Config:', JSON.stringify(mcpConfig, null, 2));
        fs.writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2), 'utf8');
    }

    private async openSettings(scope: 'user' | 'workspace'): Promise<void> {
        // Open the mcp.json file directly
        const mcpPath = scope === 'user' 
            ? this.getMcpJsonPath()
            : vscode.workspace.workspaceFolders 
                ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', 'mcp.json')
                : null;
        
        if (mcpPath) {
            const uri = vscode.Uri.file(mcpPath);
            await vscode.window.showTextDocument(uri);
        }
    }

    /**
     * Open the MCP configuration file that contains the Neon server config
     */
    private async openMcpConfigFile(): Promise<void> {
        // First check workspace config, then fall back to user config
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let mcpPath: string | null = null;

        // Check workspace config first
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceMcpPath = path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'mcp.json');
            if (fs.existsSync(workspaceMcpPath)) {
                const content = fs.readFileSync(workspaceMcpPath, 'utf8');
                try {
                    const config = JSON.parse(content);
                    // Check if Neon config is in workspace (case-insensitive)
                    const hasMcpServersNeon = this.findNeonServerKey(config.mcpServers) !== null;
                    const hasServersNeon = this.findNeonServerKey(config.servers) !== null;
                    if (hasMcpServersNeon || hasServersNeon) {
                        mcpPath = workspaceMcpPath;
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
        }

        // Fall back to user config
        if (!mcpPath) {
            const userMcpPath = this.getMcpJsonPath();
            if (fs.existsSync(userMcpPath)) {
                mcpPath = userMcpPath;
            }
        }

        if (mcpPath) {
            const uri = vscode.Uri.file(mcpPath);
            await vscode.window.showTextDocument(uri);
        } else {
            vscode.window.showWarningMessage('MCP configuration file not found');
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Server</title>
    <style>
        body {
            padding: 16px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
        }
        
        .status-message {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 12px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 13px;
        }
        
        .status-icon {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 2px;
        }
        
        .status-icon svg {
            width: 16px;
            height: 16px;
        }
        
        .status-text {
            flex: 1;
        }
        
        .status-text strong {
            display: block;
            margin-bottom: 4px;
        }
        
        .status-secondary {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        .hidden {
            display: none;
        }
        
        .configure-button {
            margin-top: 12px;
            padding: 6px 14px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }
        
        .configure-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .configure-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .secondary-button {
            margin-top: 8px;
            padding: 6px 14px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }
        
        .secondary-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .secondary-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .view-config-link {
            display: inline-block;
            margin-top: 8px;
            color: var(--vscode-textLink-foreground);
            font-size: 12px;
            text-decoration: none;
            cursor: pointer;
        }
        
        .view-config-link:hover {
            text-decoration: underline;
        }
        
        .button-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 12px;
        }
    </style>
</head>
<body>
    <div id="configured-view" class="hidden">
        <div class="status-message">
            <span class="status-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="7" stroke="var(--vscode-charts-green)" stroke-width="1.5"/>
                    <path d="M5 8L7 10L11 6" stroke="var(--vscode-charts-green)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </span>
            <div class="status-text">
                <strong>Neon MCP server is configured</strong>
                <div class="status-secondary" id="configured-message">Auto-configuration is enabled.</div>
                <a href="#" id="view-config-link" class="view-config-link">View configuration</a>
            </div>
        </div>
    </div>
    
    <div id="non-managed-view" class="hidden">
        <div class="status-message">
            <span class="status-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="8" cy="8" r="7" stroke="var(--vscode-editorInfo-foreground)" stroke-width="1.5"/>
                    <path d="M8 4.5V5" stroke="var(--vscode-editorInfo-foreground)" stroke-width="1.5" stroke-linecap="round"/>
                    <path d="M8 7V11.5" stroke="var(--vscode-editorInfo-foreground)" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            </span>
            <div class="status-text">
                <strong>Non-managed Neon MCP server detected</strong>
                <div class="status-secondary" id="non-managed-message">
                    A Neon MCP server configuration was detected that differs from the extension-managed configuration. The extension was unable to automatically configure the MCP server.
                </div>
                <div class="button-group">
                    <a href="#" id="non-managed-view-config-link" class="view-config-link" style="margin-top: 0;">View configuration</a>
                    <button id="reconfigure-button" class="secondary-button">Re-configure MCP Server</button>
                </div>
            </div>
        </div>
    </div>
    
    <div id="not-configured-view" class="hidden">
        <div class="status-message">
            <span class="status-icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1.5L14.5 13.5H1.5L8 1.5Z" stroke="var(--vscode-editorWarning-foreground)" stroke-width="1.5" stroke-linejoin="round"/>
                    <path d="M8 6V9" stroke="var(--vscode-editorWarning-foreground)" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="8" cy="11.5" r="0.75" fill="var(--vscode-editorWarning-foreground)"/>
                </svg>
            </span>
            <div class="status-text">
                <strong>Neon MCP server is not configured</strong>
                <div class="status-secondary" id="not-configured-message">Auto-configuration is enabled.</div>
                <button id="configure-button" class="configure-button hidden">Configure MCP Server</button>
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        // Check configuration on load
        vscode.postMessage({ command: 'checkConfiguration' });
        
        // Configure button click handler
        document.getElementById('configure-button').addEventListener('click', function() {
            this.disabled = true;
            this.textContent = 'Configuring...';
            vscode.postMessage({ command: 'configureMcpServer' });
        });
        
        // Reconfigure button click handler
        document.getElementById('reconfigure-button').addEventListener('click', function() {
            this.disabled = true;
            this.textContent = 'Re-configuring...';
            vscode.postMessage({ command: 'reconfigureMcpServer' });
        });
        
        // View configuration link click handlers
        document.getElementById('view-config-link').addEventListener('click', function(e) {
            e.preventDefault();
            vscode.postMessage({ command: 'openMcpConfigFile' });
        });
        
        document.getElementById('non-managed-view-config-link').addEventListener('click', function(e) {
            e.preventDefault();
            vscode.postMessage({ command: 'openMcpConfigFile' });
        });
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.command === 'configurationStatus') {
                const configureButton = document.getElementById('configure-button');
                const reconfigureButton = document.getElementById('reconfigure-button');
                
                // Hide all views first
                document.getElementById('configured-view').classList.add('hidden');
                document.getElementById('non-managed-view').classList.add('hidden');
                document.getElementById('not-configured-view').classList.add('hidden');
                
                if (message.isConfigured) {
                    if (message.isManaged) {
                        // Show configured view for managed configs
                        document.getElementById('configured-view').classList.remove('hidden');
                        
                        const configuredMsg = document.getElementById('configured-message');
                        if (message.autoConfigEnabled) {
                            configuredMsg.textContent = 'Auto-configuration is enabled.';
                        } else {
                            configuredMsg.textContent = 'Auto-configuration is disabled.';
                        }
                    } else {
                        // Show non-managed view for non-managed configs
                        document.getElementById('non-managed-view').classList.remove('hidden');
                        reconfigureButton.disabled = false;
                        reconfigureButton.textContent = 'Re-configure MCP Server';
                    }
                } else {
                    document.getElementById('not-configured-view').classList.remove('hidden');
                    
                    const notConfiguredMsg = document.getElementById('not-configured-message');
                    if (message.autoConfigEnabled) {
                        notConfiguredMsg.textContent = 'Click the button below to configure the MCP server.';
                        configureButton.classList.remove('hidden');
                        configureButton.disabled = false;
                        configureButton.textContent = 'Configure MCP Server';
                    } else {
                        notConfiguredMsg.textContent = 'Auto-configuration is disabled. Enable it using the title bar to automatically configure the MCP server.';
                        configureButton.classList.add('hidden');
                    }
                }
            } else if (message.command === 'configurationComplete') {
                // Re-check configuration after install
                vscode.postMessage({ command: 'checkConfiguration' });
            } else if (message.command === 'configurationFailed') {
                const configureButton = document.getElementById('configure-button');
                const reconfigureButton = document.getElementById('reconfigure-button');
                configureButton.disabled = false;
                configureButton.textContent = 'Configure MCP Server';
                reconfigureButton.disabled = false;
                reconfigureButton.textContent = 'Re-configure MCP Server';
                // The error message will be shown via VS Code notification
            }
        });
    </script>
</body>
</html>`;
    }
}

