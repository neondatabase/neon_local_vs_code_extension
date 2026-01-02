import * as vscode from 'vscode';
import * as path from 'path';
import { StateService } from './state.service';

export class PrismaIntegrationService {
    constructor(
        private stateService: StateService,
        private projectRoot: string,
        private schemaPath: string
    ) {}

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
     * Pull schema from database (prisma db pull)
     */
    async dbPull(): Promise<void> {
        const confirmation = await vscode.window.showInformationMessage(
            'Pull database schema into schema.prisma?\n\nThis will update your Prisma schema file with the current database structure.',
            { modal: true },
            'Pull Schema',
            'Cancel'
        );

        if (confirmation !== 'Pull Schema') {
            return;
        }

        const terminal = await this.createTerminal('Prisma: Pull Schema');
        terminal.show();
        terminal.sendText('echo "Pulling database schema into Prisma..."');
        terminal.sendText('npx prisma db pull');
        
        vscode.window.showInformationMessage('Pulling database schema into Prisma...');
    }

    /**
     * Push schema to database (prisma db push)
     */
    async dbPush(): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            'Push Prisma schema to database?\n\nThis will update your database without creating migrations. Use for rapid prototyping only.',
            { modal: true },
            'Push to DB',
            'Cancel'
        );

        if (confirmation !== 'Push to DB') {
            return;
        }

        const terminal = await this.createTerminal('Prisma: Push Schema');
        terminal.show();
        terminal.sendText('echo "Pushing Prisma schema to database..."');
        terminal.sendText('npx prisma db push');
        
        vscode.window.showInformationMessage('Pushing Prisma schema to database...');
    }

    /**
     * Open Prisma Studio
     */
    async openStudio(): Promise<void> {
        const terminal = await this.createTerminal('Prisma Studio');
        terminal.show();
        terminal.sendText('echo "Opening Prisma Studio..."');
        terminal.sendText('npx prisma studio');
        
        vscode.window.showInformationMessage('Opening Prisma Studio in your browser...');
    }

    /**
     * Generate Prisma Client (prisma generate)
     */
    async generateClient(): Promise<void> {
        const terminal = await this.createTerminal('Prisma: Generate Client');
        terminal.show();
        terminal.sendText('echo "Generating Prisma Client..."');
        terminal.sendText('npx prisma generate');
        
        vscode.window.showInformationMessage('Generating Prisma Client...');
    }

    /**
     * Format Prisma schema (prisma format)
     */
    async formatSchema(): Promise<void> {
        const terminal = await this.createTerminal('Prisma: Format Schema');
        terminal.show();
        terminal.sendText('npx prisma format');
        
        vscode.window.showInformationMessage('Formatting Prisma schema...');
    }

    /**
     * Validate Prisma schema (prisma validate)
     */
    async validateSchema(): Promise<void> {
        const terminal = await this.createTerminal('Prisma: Validate Schema');
        terminal.show();
        terminal.sendText('echo "Validating Prisma schema..."');
        terminal.sendText('npx prisma validate');
    }

    /**
     * Run migrations (prisma migrate dev)
     */
    async migrateDev(name?: string): Promise<void> {
        const migrationName = name || await vscode.window.showInputBox({
            prompt: 'Enter migration name',
            placeHolder: 'add_user_roles'
        });

        if (!migrationName) {
            return;
        }

        const terminal = await this.createTerminal('Prisma: Migrate Dev');
        terminal.show();
        terminal.sendText(`echo "Creating migration: ${migrationName}..."`);
        terminal.sendText(`npx prisma migrate dev --name ${migrationName}`);
        
        vscode.window.showInformationMessage(`Creating Prisma migration: ${migrationName}...`);
    }

    /**
     * Deploy migrations (prisma migrate deploy)
     */
    async migrateDeploy(): Promise<void> {
        const terminal = await this.createTerminal('Prisma: Deploy Migrations');
        terminal.show();
        terminal.sendText('echo "Deploying Prisma migrations..."');
        terminal.sendText('npx prisma migrate deploy');
        
        vscode.window.showInformationMessage('Deploying Prisma migrations...');
    }

    /**
     * Reset database (prisma migrate reset)
     */
    async migrateReset(): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            'Reset database?\n\nThis will drop the database, recreate it, and run all migrations. All data will be lost!',
            { modal: true },
            'Reset Database',
            'Cancel'
        );

        if (confirmation !== 'Reset Database') {
            return;
        }

        const terminal = await this.createTerminal('Prisma: Reset Database');
        terminal.show();
        terminal.sendText('echo "Resetting database..."');
        terminal.sendText('npx prisma migrate reset');
        
        vscode.window.showWarningMessage('Resetting database. All data will be lost!');
    }

    /**
     * Seed database (prisma db seed)
     */
    async seedDatabase(): Promise<void> {
        const terminal = await this.createTerminal('Prisma: Seed Database');
        terminal.show();
        terminal.sendText('echo "Seeding database..."');
        terminal.sendText('npx prisma db seed');
        
        vscode.window.showInformationMessage('Seeding database...');
    }

    /**
     * Open Prisma schema file
     */
    async openSchema(): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(this.schemaPath);
            await vscode.window.showTextDocument(doc);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open schema file: ${error}`);
        }
    }
}

