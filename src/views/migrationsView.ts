import * as vscode from 'vscode';
import * as path from 'path';
import { MigrationScannerService, MigrationFile, MigrationFolder } from '../services/orms_and_migrations/migration.scanner.service';
import { StateService } from '../services/state.service';
import { SqlQueryService } from '../services/sqlQuery.service';

interface MigrationTreeItem {
    id: string;
    label: string;
    type: 'folder' | 'file';
    file?: MigrationFile;
    folder?: MigrationFolder;
    collapsibleState?: vscode.TreeItemCollapsibleState;
}

export class MigrationTreeItemUI extends vscode.TreeItem {
    constructor(
        public readonly item: MigrationTreeItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(item.label, collapsibleState);
        
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.iconPath = this.getIcon();
        this.contextValue = item.type;
        
        // Set command for files
        if (item.type === 'file' && item.file) {
            this.command = {
                command: 'neonLocal.migrations.openFile',
                title: 'Open File',
                arguments: [item.file]
            };
        }
    }

    private getTooltip(): string {
        const { item } = this;
        if (item.type === 'folder' && item.folder) {
            const fileCount = item.folder.files.length;
            return `${item.folder.name}\n${fileCount} file${fileCount !== 1 ? 's' : ''}${item.folder.framework ? `\nFramework: ${item.folder.framework}` : ''}`;
        } else if (item.type === 'file' && item.file) {
            return `${item.file.name}\nType: ${item.file.type}\nPath: ${item.file.relativePath}${item.file.framework ? `\nFramework: ${item.file.framework}` : ''}`;
        }
        return item.label;
    }

    private getDescription(): string | undefined {
        const { item } = this;
        if (item.type === 'folder' && item.folder) {
            if (item.folder.framework) {
                return item.folder.framework;
            }
        } else if (item.type === 'file' && item.file) {
            if (item.file.timestamp) {
                return `v${item.file.timestamp}`;
            }
        }
        return undefined;
    }

    private getIcon(): vscode.ThemeIcon {
        const { item } = this;
        if (item.type === 'folder') {
            return new vscode.ThemeIcon('folder');
        } else if (item.type === 'file' && item.file) {
            switch (item.file.type) {
                case 'migration':
                    return new vscode.ThemeIcon('database');
                case 'seed':
                    return new vscode.ThemeIcon('symbol-namespace');
                case 'query':
                default:
                    return new vscode.ThemeIcon('file-code');
            }
        }
        return new vscode.ThemeIcon('file');
    }
}

export class MigrationsTreeProvider implements vscode.TreeDataProvider<MigrationTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<MigrationTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<MigrationTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<MigrationTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private migrationScanner: MigrationScannerService;
    private folders: MigrationFolder[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService
    ) {
        this.migrationScanner = new MigrationScannerService();
        
        // Watch for file changes
        this.migrationScanner.watchMigrations(() => {
            this.refresh();
        });

        // Initial scan
        this.refresh();
    }

    refresh(): void {
        this.migrationScanner.scanWorkspace().then(folders => {
            this.folders = folders;
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element: MigrationTreeItem): vscode.TreeItem {
        return new MigrationTreeItemUI(
            element,
            element.collapsibleState || vscode.TreeItemCollapsibleState.None
        );
    }

    async getChildren(element?: MigrationTreeItem): Promise<MigrationTreeItem[]> {
        if (!element) {
            // Root level - return folders
            if (this.folders.length === 0) {
                return [];
            }

            return this.folders.map(folder => ({
                id: folder.id,
                label: folder.name,
                type: 'folder' as const,
                folder,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
            }));
        } else if (element.type === 'folder' && element.folder) {
            // Return files in folder
            return element.folder.files.map(file => ({
                id: file.id,
                label: file.name,
                type: 'file' as const,
                file,
                collapsibleState: vscode.TreeItemCollapsibleState.None
            }));
        }

        return [];
    }

    dispose(): void {
        this.migrationScanner.dispose();
    }
}

export class MigrationsViewProvider {
    private treeView: vscode.TreeDataProvider<MigrationTreeItem>;

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService
    ) {
        const treeDataProvider = new MigrationsTreeProvider(context, stateService);
        this.treeView = treeDataProvider;

        // Register tree view
        const view = vscode.window.createTreeView('neonLocalMigrations', {
            treeDataProvider,
            showCollapseAll: true
        });

        context.subscriptions.push(view);

        // Register commands
        this.registerCommands(treeDataProvider);
    }

    private registerCommands(treeProvider: MigrationsTreeProvider): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.migrations.refresh', () => {
                treeProvider.refresh();
            }),
            vscode.commands.registerCommand('neonLocal.migrations.openFile', (file: MigrationFile) => {
                this.openFile(file);
            }),
            vscode.commands.registerCommand('neonLocal.migrations.runFile', (file: MigrationFile) => {
                this.runFile(file);
            }),
            vscode.commands.registerCommand('neonLocal.migrations.runFolder', async (item: MigrationTreeItem) => {
                if (item.folder) {
                    await this.runFolder(item.folder);
                }
            })
        );
    }

    private async openFile(file: MigrationFile): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(file.path);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Find Django manage.py file in workspace
     */
    private async findDjangoManagePy(migrationPath: string): Promise<string | null> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return null;
        }

        // Start from the migration path and walk up to find manage.py
        let currentPath = path.dirname(migrationPath);
        const rootPath = workspaceFolders[0].uri.fsPath;

        while (currentPath.startsWith(rootPath)) {
            const managePyPath = path.join(currentPath, 'manage.py');
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(managePyPath));
                return managePyPath;
            } catch {
                // File doesn't exist, try parent
            }
            
            const parentPath = path.dirname(currentPath);
            if (parentPath === currentPath) {
                break; // Reached root
            }
            currentPath = parentPath;
        }

        return null;
    }

    /**
     * Find Python virtual environment and return the Python executable path
     */
    private async findPythonExecutable(projectRoot: string): Promise<string> {
        const isWindows = process.platform === 'win32';
        
        // Check for VS Code Python extension's selected interpreter first
        const pythonConfig = vscode.workspace.getConfiguration('python');
        const pythonPath = pythonConfig.get<string>('pythonPath') || pythonConfig.get<string>('defaultInterpreterPath');
        
        if (pythonPath && pythonPath !== 'python') {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(pythonPath));
                return pythonPath;
            } catch {
                // Fall through to venv detection
            }
        }

        // Common venv directory names
        const venvNames = ['venv', '.venv', 'env', '.env', 'virtualenv', '.virtualenv'];
        
        // Python executable paths (relative to venv root)
        const pythonPaths = isWindows 
            ? ['Scripts\\python.exe', 'Scripts\\python3.exe']
            : ['bin/python', 'bin/python3'];

        // Search for venv in project root and parent directories
        let searchPath = projectRoot;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        
        while (workspaceRoot && searchPath.startsWith(workspaceRoot)) {
            for (const venvName of venvNames) {
                const venvPath = path.join(searchPath, venvName);
                
                for (const pyPath of pythonPaths) {
                    const fullPythonPath = path.join(venvPath, pyPath);
                    try {
                        await vscode.workspace.fs.stat(vscode.Uri.file(fullPythonPath));
                        return fullPythonPath;
                    } catch {
                        // Try next path
                    }
                }
            }
            
            // Move up one directory
            const parentPath = path.dirname(searchPath);
            if (parentPath === searchPath) {
                break;
            }
            searchPath = parentPath;
        }

        // Fallback to system Python
        return isWindows ? 'python' : 'python3';
    }

    /**
     * Run Django migrations using manage.py
     */
    private async runDjangoMigrations(managePyPath: string, appName?: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const projectRoot = path.dirname(managePyPath);

        // Find Python executable (venv or system)
        const pythonExecutable = await this.findPythonExecutable(projectRoot);
        const isVenv = !['python', 'python3'].includes(pythonExecutable);

        // Get connection details from state
        const viewData = await this.stateService.getViewData();
        
        // Prepare environment with database connection
        const env: { [key: string]: string } = {
            ...process.env as { [key: string]: string },
        };

        // Set DATABASE_URL if we have connection info
        if (viewData.connected && viewData.connectionString) {
            env.DATABASE_URL = viewData.connectionString;
        }

        // Create terminal and run migration
        const terminal = vscode.window.createTerminal({
            name: 'Django Migrations',
            cwd: projectRoot,
            env
        });

        terminal.show();
        
        // Show info about which Python is being used
        if (isVenv) {
            terminal.sendText(`echo "Using Python from virtual environment: ${pythonExecutable}"`);
        } else {
            terminal.sendText(`echo "Using system Python: ${pythonExecutable}"`);
        }
        
        // Run migration command
        const migrateCmd = appName 
            ? `"${pythonExecutable}" manage.py migrate ${appName}` 
            : `"${pythonExecutable}" manage.py migrate`;
        
        terminal.sendText(migrateCmd);
        
        vscode.window.showInformationMessage(
            `Running Django migrations${appName ? ` for app: ${appName}` : ''}...\n${isVenv ? '✓ Using virtual environment' : 'Using system Python'}\nCheck the terminal for output.`
        );
    }

    /**
     * Extract Django app name from migration path
     */
    private extractDjangoAppName(migrationPath: string): string | null {
        // Path typically looks like: .../appname/migrations/0001_initial.py
        const parts = migrationPath.split(path.sep);
        const migrationsIndex = parts.findIndex(p => p === 'migrations');
        
        if (migrationsIndex > 0) {
            return parts[migrationsIndex - 1];
        }
        
        return null;
    }

    private async runFile(file: MigrationFile): Promise<void> {
        try {
            // Check if connected
            const viewData = await this.stateService.getViewData();
            if (!viewData.connected) {
                const connect = await vscode.window.showWarningMessage(
                    'Not connected to a database. Would you like to connect?',
                    'Connect',
                    'Cancel'
                );
                if (connect === 'Connect') {
                    await vscode.commands.executeCommand('neon-local-connect.configure');
                }
                return;
            }

            // Read file content
            const scanner = new MigrationScannerService();
            const content = await scanner.readFileContent(file.path);

            // Check if it's a SQL file
            const ext = path.extname(file.path).toLowerCase();
            if (ext !== '.sql') {
                vscode.window.showWarningMessage(
                    `Only .sql files can be executed directly. File type: ${ext}\n\nFor ${file.framework || 'framework-specific'} migrations, use the appropriate CLI tool.`
                );
                return;
            }

            // Confirm execution
            const confirmation = await vscode.window.showWarningMessage(
                `Execute migration: ${file.name}?\n\nThis will run the SQL commands against the currently connected database.`,
                { modal: true },
                'Execute',
                'Preview SQL',
                'Cancel'
            );

            if (!confirmation || confirmation === 'Cancel') {
                return;
            }

            if (confirmation === 'Preview SQL') {
                const doc = await vscode.workspace.openTextDocument({
                    content,
                    language: 'sql'
                });
                await vscode.window.showTextDocument(doc);
                return;
            }

            // Execute the SQL
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Executing ${file.name}...`,
                cancellable: false
            }, async (progress) => {
                const sqlService = new SqlQueryService(this.stateService, this.context);
                const result = await sqlService.executeQuery(content, viewData.selectedDatabase);

                vscode.window.showInformationMessage(
                    `✓ Successfully executed ${file.name}\nRows affected: ${result.rowCount || 0}\nExecution time: ${result.executionTime}ms`
                );
            });

        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to execute migration: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private async runFolder(folder: MigrationFolder): Promise<void> {
        try {
            // Check if connected
            const viewData = await this.stateService.getViewData();
            if (!viewData.connected) {
                const connect = await vscode.window.showWarningMessage(
                    'Not connected to a database. Would you like to connect?',
                    'Connect',
                    'Cancel'
                );
                if (connect === 'Connect') {
                    await vscode.commands.executeCommand('neon-local-connect.configure');
                }
                return;
            }

            // Check if this is a Django project
            if (folder.framework === 'Django' || folder.files.some(f => f.path.endsWith('.py'))) {
                const managePyPath = await this.findDjangoManagePy(folder.path);
                
                if (managePyPath) {
                    const appName = this.extractDjangoAppName(folder.path);
                    
                    const confirmation = await vscode.window.showInformationMessage(
                        `Django project detected!\n\nRun migrations${appName ? ` for app "${appName}"` : ''}?`,
                        { modal: true },
                        'Run Migrations',
                        'Run All Apps',
                        'Cancel'
                    );

                    if (confirmation === 'Run Migrations') {
                        await this.runDjangoMigrations(managePyPath, appName || undefined);
                        return;
                    } else if (confirmation === 'Run All Apps') {
                        await this.runDjangoMigrations(managePyPath);
                        return;
                    }
                    return;
                }
            }

            // Filter SQL files only
            const sqlFiles = folder.files.filter(f => path.extname(f.path).toLowerCase() === '.sql');
            
            if (sqlFiles.length === 0) {
                vscode.window.showWarningMessage(
                    `No .sql files found in ${folder.name}.\n\nFor ${folder.framework || 'framework-specific'} migrations, use the appropriate CLI tool.`
                );
                return;
            }

            // Confirm execution
            const confirmation = await vscode.window.showWarningMessage(
                `Execute all migrations in "${folder.name}"?\n\n${sqlFiles.length} file(s) will be executed in order.`,
                { modal: true },
                'Execute All',
                'Cancel'
            );

            if (!confirmation || confirmation === 'Cancel') {
                return;
            }

            // Execute all files
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Executing migrations from ${folder.name}...`,
                cancellable: false
            }, async (progress) => {
                const sqlService = new SqlQueryService(this.stateService, this.context);
                const scanner = new MigrationScannerService();
                let successCount = 0;
                let failedFiles: string[] = [];

                for (let i = 0; i < sqlFiles.length; i++) {
                    const file = sqlFiles[i];
                    progress.report({
                        message: `${i + 1}/${sqlFiles.length}: ${file.name}`,
                        increment: (100 / sqlFiles.length)
                    });

                    try {
                        const content = await scanner.readFileContent(file.path);
                        await sqlService.executeQuery(content, viewData.selectedDatabase);
                        successCount++;
                    } catch (error) {
                        failedFiles.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }

                if (failedFiles.length === 0) {
                    vscode.window.showInformationMessage(
                        `✓ Successfully executed all ${successCount} migration(s) from ${folder.name}`
                    );
                } else {
                    vscode.window.showWarningMessage(
                        `Executed ${successCount}/${sqlFiles.length} migration(s).\n\nFailed:\n${failedFiles.join('\n')}`
                    );
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to execute migrations: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}


