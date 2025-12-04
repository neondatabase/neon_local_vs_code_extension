import * as vscode from 'vscode';
import * as path from 'path';
import { StateService } from './state.service';

export class DjangoIntegrationService {
    constructor(
        private stateService: StateService,
        private projectRoot: string,
        private managePyPath: string
    ) {}

    /**
     * Find Python executable (same logic as migrationsView)
     */
    private async findPythonExecutable(): Promise<string> {
        const isWindows = process.platform === 'win32';
        
        // Check for VS Code Python extension's selected interpreter
        const pythonConfig = vscode.workspace.getConfiguration('python');
        const pythonPath = pythonConfig.get<string>('pythonPath') || pythonConfig.get<string>('defaultInterpreterPath');
        
        if (pythonPath && pythonPath !== 'python') {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(pythonPath));
                return pythonPath;
            } catch {
                // Fall through
            }
        }

        // Search for venv
        const venvNames = ['venv', '.venv', 'env', '.env', 'virtualenv', '.virtualenv'];
        const pythonPaths = isWindows 
            ? ['Scripts\\python.exe', 'Scripts\\python3.exe']
            : ['bin/python', 'bin/python3'];

        let searchPath = this.projectRoot;
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
                        // Try next
                    }
                }
            }
            
            const parentPath = path.dirname(searchPath);
            if (parentPath === searchPath) break;
            searchPath = parentPath;
        }

        return isWindows ? 'python' : 'python3';
    }

    /**
     * Get DATABASE_URL from state
     */
    private async getDatabaseURL(): Promise<string | undefined> {
        const viewData = await this.stateService.getViewData();
        if (viewData.connected && viewData.connectionString) {
            return viewData.connectionString;
        }
        return undefined;
    }

    /**
     * Create terminal with proper environment
     */
    private async createTerminal(name: string): Promise<vscode.Terminal> {
        const env: { [key: string]: string } = {
            ...process.env as { [key: string]: string },
        };

        const dbUrl = await this.getDatabaseURL();
        if (dbUrl) {
            env.DATABASE_URL = dbUrl;
        }

        return vscode.window.createTerminal({
            name,
            cwd: this.projectRoot,
            env
        });
    }

    /**
     * Make migrations (python manage.py makemigrations)
     */
    async makeMigrations(appName?: string): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        const terminal = await this.createTerminal('Django: Make Migrations');
        
        terminal.show();
        terminal.sendText(`echo "Making Django migrations..."`);
        
        const cmd = appName 
            ? `"${pythonExec}" manage.py makemigrations ${appName}`
            : `"${pythonExec}" manage.py makemigrations`;
        
        terminal.sendText(cmd);
        
        vscode.window.showInformationMessage(
            `Making Django migrations${appName ? ` for ${appName}` : ''}...`
        );
    }

    /**
     * Show SQL for a migration (python manage.py sqlmigrate)
     */
    async showMigrationSQL(appName: string, migrationName: string): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        const terminal = await this.createTerminal('Django: Migration SQL');
        
        terminal.show();
        terminal.sendText(`echo "Showing SQL for ${appName} ${migrationName}..."`);
        terminal.sendText(`"${pythonExec}" manage.py sqlmigrate ${appName} ${migrationName}`);
    }

    /**
     * Rollback to a specific migration
     */
    async rollbackMigration(appName: string, targetMigration?: string): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        
        // Confirm rollback
        const target = targetMigration || 'zero';
        const confirmation = await vscode.window.showWarningMessage(
            `Rollback ${appName} to ${target}?\n\nThis will undo migrations and may cause data loss.`,
            { modal: true },
            'Rollback',
            'Cancel'
        );

        if (confirmation !== 'Rollback') {
            return;
        }

        const terminal = await this.createTerminal('Django: Rollback');
        terminal.show();
        terminal.sendText(`echo "Rolling back ${appName} to ${target}..."`);
        terminal.sendText(`"${pythonExec}" manage.py migrate ${appName} ${target}`);
        
        vscode.window.showInformationMessage(`Rolling back ${appName} migrations...`);
    }

    /**
     * Open Django shell
     */
    async openShell(): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        const terminal = await this.createTerminal('Django Shell');
        
        terminal.show();
        terminal.sendText(`echo "Opening Django shell..."`);
        terminal.sendText(`"${pythonExec}" manage.py shell`);
    }

    /**
     * Run migrations for a specific app or all apps
     */
    async runMigrations(appName?: string): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        const terminal = await this.createTerminal('Django: Run Migrations');
        
        terminal.show();
        terminal.sendText(`echo "Running Django migrations..."`);
        
        const cmd = appName 
            ? `"${pythonExec}" manage.py migrate ${appName}`
            : `"${pythonExec}" manage.py migrate`;
        
        terminal.sendText(cmd);
        
        vscode.window.showInformationMessage(
            `Running Django migrations${appName ? ` for ${appName}` : ''}...`
        );
    }

    /**
     * Get list of pending migrations
     */
    async getPendingMigrations(): Promise<{app: string, migration: string}[]> {
        try {
            const pythonExec = await this.findPythonExecutable();
            const dbUrl = await this.getDatabaseURL();
            
            // Create a script to get pending migrations
            const script = `
import sys
import os
${dbUrl ? `os.environ['DATABASE_URL'] = '${dbUrl}'` : ''}
try:
    import django
    from django.core.management import execute_from_command_line
    sys.argv = ['manage.py', 'showmigrations', '--plan']
    execute_from_command_line(sys.argv)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
`;
            
            // For now, return empty - would need proper execution and parsing
            return [];
        } catch {
            return [];
        }
    }

    /**
     * Generate model code from database table
     */
    async generateModelFromTable(tableName: string, appName?: string): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        const terminal = await this.createTerminal('Django: Generate Model');
        
        terminal.show();
        terminal.sendText(`echo "Generating Django model for ${tableName}..."`);
        terminal.sendText(`"${pythonExec}" manage.py inspectdb ${tableName}`);
        
        vscode.window.showInformationMessage(
            `Generated model code for ${tableName}. Copy from terminal and paste into models.py`
        );
    }

    /**
     * Show migration status
     */
    async showMigrationStatus(): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        const terminal = await this.createTerminal('Django: Migration Status');
        
        terminal.show();
        terminal.sendText(`echo "Django migration status:"`);
        terminal.sendText(`"${pythonExec}" manage.py showmigrations`);
    }

    /**
     * Run Django tests
     */
    async runTests(appName?: string, testPath?: string): Promise<void> {
        const pythonExec = await this.findPythonExecutable();
        const terminal = await this.createTerminal('Django: Tests');
        
        terminal.show();
        
        let cmd = `"${pythonExec}" manage.py test`;
        if (testPath) {
            cmd += ` ${testPath}`;
        } else if (appName) {
            cmd += ` ${appName}`;
        }
        
        terminal.sendText(`echo "Running Django tests..."`);
        terminal.sendText(cmd);
    }
}

