import * as vscode from 'vscode';
import { ORMDetectorService, ORMConfig, ORMType } from './services/orm.detector.service';
import { DjangoIntegrationService } from './services/django.integration.service';
import { PrismaIntegrationService } from './services/prisma.integration.service';
import { StateService } from './services/state.service';
import { SchemaService } from './services/schema.service';
import { DjangoModelParserService, DjangoApp, DjangoModel, DjangoMigration } from './services/django.model.parser.service';
import { PrismaModelParserService, PrismaModel, PrismaMigration } from './services/prisma.model.parser.service';
import { MigrationStatusService } from './services/migration.status.service';

interface ORMTreeItem {
    id: string;
    label: string;
    type: 'root' | 'orm' | 'section' | 'app' | 'model' | 'migration' | 'action';
    ormType?: ORMType;
    ormConfig?: ORMConfig;
    action?: string;
    model?: DjangoModel | PrismaModel;
    migration?: DjangoMigration | PrismaMigration;
    app?: DjangoApp;
    status?: 'synced' | 'changed' | 'missing' | 'pending' | 'applied';
    collapsibleState?: vscode.TreeItemCollapsibleState;
}

export class ORMTreeItemUI extends vscode.TreeItem {
    constructor(
        public readonly item: ORMTreeItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(item.label, collapsibleState);
        
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.iconPath = this.getIcon();
        this.contextValue = this.getContextValue();
        
        // Set command for action items
        if (item.type === 'action' && item.action && item.ormType) {
            this.command = {
                command: `neonLocal.orm.${item.ormType}.${item.action}`,
                title: item.label,
                arguments: [item]
            };
        }
        
        // Commands for models and migrations
        if (item.type === 'model' || item.type === 'migration') {
            // Click to open file
            if (item.model) {
                this.command = {
                    command: 'neonLocal.orm.openModelFile',
                    title: 'Open Model',
                    arguments: [item]
                };
            } else if (item.migration) {
                this.command = {
                    command: 'neonLocal.orm.openMigrationFile',
                    title: 'Open Migration',
                    arguments: [item]
                };
            }
        }
    }

    private getContextValue(): string {
        const { item } = this;
        if (item.type === 'model') {
            return `model_${item.ormType}`;
        } else if (item.type === 'migration') {
            return `migration_${item.ormType}`;
        } else if (item.type === 'app') {
            return `app_${item.ormType}`;
        }
        return item.type;
    }

    private getTooltip(): string {
        const { item } = this;
        
        if (item.type === 'orm' && item.ormConfig) {
            return `${item.ormConfig.name}\nProject: ${item.ormConfig.projectRoot || 'Detected'}`;
        } else if (item.type === 'model') {
            const model = item.model as DjangoModel | PrismaModel;
            let tip = `Model: ${model.name}\nTable: ${model.tableName}\n`;
            if (item.status === 'synced') {
                tip += '✓ Synced with database';
            } else if (item.status === 'changed') {
                tip += '⚠️ Schema has changes';
            } else if (item.status === 'missing') {
                tip += '❌ Table does not exist in database';
            }
            return tip;
        } else if (item.type === 'migration') {
            const migration = item.migration as DjangoMigration | PrismaMigration;
            let tip = `Migration: ${migration.name}\n`;
            if (item.status === 'applied') {
                tip += '✓ Applied to database';
            } else if (item.status === 'pending') {
                tip += '⏳ Pending - not applied yet';
            }
            return tip;
        } else if (item.type === 'action') {
            return `Click to ${item.label.toLowerCase()}`;
        }
        
        return item.label;
    }

    private getDescription(): string | undefined {
        const { item } = this;
        
        if (item.type === 'orm' && item.ormConfig?.projectRoot) {
            return item.ormConfig.projectRoot.split('/').pop();
        } else if (item.type === 'model') {
            const model = item.model as DjangoModel | PrismaModel;
            return model.tableName;
        } else if (item.type === 'migration') {
            if (item.status === 'applied') {
                return '✓ Applied';
            } else if (item.status === 'pending') {
                return '⏳ Pending';
            }
        }
        
        return undefined;
    }

    private getIcon(): vscode.ThemeIcon {
        const { item } = this;
        
        if (item.type === 'orm' && item.ormConfig) {
            return new vscode.ThemeIcon(item.ormConfig.icon);
        } else if (item.type === 'section') {
            if (item.label.includes('Models')) {
                return new vscode.ThemeIcon('symbol-class');
            } else if (item.label.includes('Migrations')) {
                return new vscode.ThemeIcon('database');
            } else if (item.label.includes('Actions')) {
                return new vscode.ThemeIcon('rocket');
            }
        } else if (item.type === 'app') {
            return new vscode.ThemeIcon('folder');
        } else if (item.type === 'model') {
            if (item.status === 'synced') {
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('testing.iconPassed'));
            } else if (item.status === 'changed') {
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('list.warningForeground'));
            } else if (item.status === 'missing') {
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('testing.iconFailed'));
            }
            return new vscode.ThemeIcon('file-code');
        } else if (item.type === 'migration') {
            if (item.status === 'applied') {
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            } else if (item.status === 'pending') {
                return new vscode.ThemeIcon('history', new vscode.ThemeColor('list.warningForeground'));
            }
            return new vscode.ThemeIcon('file');
        } else if (item.type === 'action') {
            if (item.action?.includes('pull')) {
                return new vscode.ThemeIcon('cloud-download');
            } else if (item.action?.includes('push')) {
                return new vscode.ThemeIcon('cloud-upload');
            } else if (item.action?.includes('studio')) {
                return new vscode.ThemeIcon('browser');
            } else if (item.action?.includes('shell')) {
                return new vscode.ThemeIcon('terminal');
            }
            return new vscode.ThemeIcon('play');
        }
        
        return new vscode.ThemeIcon('folder');
    }
}

export class ORMTreeProviderEnhanced implements vscode.TreeDataProvider<ORMTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ORMTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<ORMTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ORMTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private ormDetector: ORMDetectorService;
    private detectedORMs: ORMConfig[] = [];
    private migrationStatusService: MigrationStatusService;

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schemaService: SchemaService
    ) {
        this.ormDetector = new ORMDetectorService();
        this.migrationStatusService = new MigrationStatusService(stateService, context);
        this.refresh();
    }

    refresh(): void {
        this.ormDetector.detectORMs().then(orms => {
            this.detectedORMs = orms;
            console.log(`[ORM View Enhanced] Detected ${orms.length} ORM(s):`, orms.map(o => o.name).join(', '));
            this._onDidChangeTreeData.fire();
        }).catch(error => {
            console.error('[ORM View Enhanced] Error detecting ORMs:', error);
        });
    }

    getTreeItem(element: ORMTreeItem): vscode.TreeItem {
        return new ORMTreeItemUI(
            element,
            element.collapsibleState || vscode.TreeItemCollapsibleState.None
        );
    }

    async getChildren(element?: ORMTreeItem): Promise<ORMTreeItem[]> {
        if (!element) {
            // Root level - show detected ORMs
            if (this.detectedORMs.length === 0) {
                return [{
                    id: 'no_orms',
                    label: 'No ORMs detected',
                    type: 'root',
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }];
            }

            return this.detectedORMs.map(orm => ({
                id: `orm_${orm.type}`,
                label: orm.name,
                type: 'orm',
                ormType: orm.type,
                ormConfig: orm,
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded
            }));
        } else if (element.type === 'orm') {
            // ORM level - show sections: Models, Migrations, Quick Actions
            return this.getORMSections(element.ormType!, element.ormConfig!);
        } else if (element.type === 'section') {
            // Section level - show content
            return this.getSectionContent(element);
        } else if (element.type === 'app') {
            // App level (Django) - show models
            return this.getAppModels(element);
        }

        return [];
    }

    private getORMSections(ormType: ORMType, config: ORMConfig): ORMTreeItem[] {
        return [
            {
                id: `${ormType}_models`,
                label: '📂 Models',
                type: 'section',
                ormType,
                ormConfig: config,
                collapsibleState: vscode.TreeItemCollapsibleState.Expanded
            },
            {
                id: `${ormType}_migrations`,
                label: '🗄️ Migrations',
                type: 'section',
                ormType,
                ormConfig: config,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
            },
            {
                id: `${ormType}_actions`,
                label: '⚡ Quick Actions',
                type: 'section',
                ormType,
                ormConfig: config,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
            }
        ];
    }

    private async getSectionContent(section: ORMTreeItem): Promise<ORMTreeItem[]> {
        if (section.label.includes('Models')) {
            return this.getModels(section.ormType!, section.ormConfig!);
        } else if (section.label.includes('Migrations')) {
            return this.getMigrations(section.ormType!, section.ormConfig!);
        } else if (section.label.includes('Actions')) {
            return this.getQuickActions(section.ormType!, section.ormConfig!);
        }
        return [];
    }

    private async getModels(ormType: ORMType, config: ORMConfig): Promise<ORMTreeItem[]> {
        if (ormType === 'django') {
            return this.getDjangoModels(config);
        } else if (ormType === 'prisma') {
            return this.getPrismaModels(config);
        }
        return [];
    }

    private async getDjangoModels(config: ORMConfig): Promise<ORMTreeItem[]> {
        try {
            const parser = new DjangoModelParserService(config.projectRoot!);
            const apps = await parser.findApps();

            // Show apps as folders, each containing models
            return apps.map(app => ({
                id: `django_app_${app.name}`,
                label: app.name,
                type: 'app',
                app,
                ormType: 'django' as ORMType,
                ormConfig: config,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
            }));
        } catch (error) {
            console.error('[ORM View] Error loading Django models:', error);
            return [];
        }
    }

    private async getAppModels(appItem: ORMTreeItem): Promise<ORMTreeItem[]> {
        if (!appItem.app) return [];

        const items: ORMTreeItem[] = [];
        
        for (const model of appItem.app.models) {
            // Check if table exists and detect drift
            const tableExists = await this.migrationStatusService.tableExists(model.tableName!);
            
            let status: 'synced' | 'changed' | 'missing' = 'synced';
            if (!tableExists) {
                status = 'missing';
            } else {
                // Could check for drift here
                const drift = await this.migrationStatusService.detectDjangoDrift(
                    model.tableName!,
                    model.fields
                );
                if (drift.hasChanges) {
                    status = 'changed';
                }
            }

            items.push({
                id: `django_model_${appItem.app.name}_${model.name}`,
                label: model.name,
                type: 'model',
                model,
                status,
                ormType: 'django',
                ormConfig: appItem.ormConfig,
                collapsibleState: vscode.TreeItemCollapsibleState.None
            });
        }

        return items;
    }

    private async getPrismaModels(config: ORMConfig): Promise<ORMTreeItem[]> {
        try {
            const parser = new PrismaModelParserService(config.configPath!);
            const models = await parser.parseModels();

            const items: ORMTreeItem[] = [];
            
            for (const model of models) {
                const tableExists = await this.migrationStatusService.tableExists(model.tableName);
                const status: 'synced' | 'changed' | 'missing' = tableExists ? 'synced' : 'missing';

                items.push({
                    id: `prisma_model_${model.name}`,
                    label: model.name,
                    type: 'model',
                    model,
                    status,
                    ormType: 'prisma',
                    ormConfig: config,
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                });
            }

            return items;
        } catch (error) {
            console.error('[ORM View] Error loading Prisma models:', error);
            return [];
        }
    }

    private async getMigrations(ormType: ORMType, config: ORMConfig): Promise<ORMTreeItem[]> {
        if (ormType === 'django') {
            return this.getDjangoMigrations(config);
        } else if (ormType === 'prisma') {
            return this.getPrismaMigrations(config);
        }
        return [];
    }

    private async getDjangoMigrations(config: ORMConfig): Promise<ORMTreeItem[]> {
        try {
            const parser = new DjangoModelParserService(config.projectRoot!);
            const migrations = await parser.findMigrations();
            
            // Check which are applied
            const appliedSet = await this.migrationStatusService.getDjangoAppliedMigrations();
            const migrationsWithStatus = await parser.checkMigrationStatus(migrations, appliedSet);

            // Group by app
            const byApp = new Map<string, DjangoMigration[]>();
            for (const migration of migrationsWithStatus) {
                if (!byApp.has(migration.appName)) {
                    byApp.set(migration.appName, []);
                }
                byApp.get(migration.appName)!.push(migration);
            }

            // Create tree items grouped by app
            const items: ORMTreeItem[] = [];
            for (const [appName, appMigrations] of byApp) {
                for (const migration of appMigrations) {
                    items.push({
                        id: `django_migration_${appName}_${migration.name}`,
                        label: `${appName}/${migration.name}`,
                        type: 'migration',
                        migration,
                        status: migration.isApplied ? 'applied' : 'pending',
                        ormType: 'django',
                        ormConfig: config,
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    });
                }
            }

            return items;
        } catch (error) {
            console.error('[ORM View] Error loading Django migrations:', error);
            return [];
        }
    }

    private async getPrismaMigrations(config: ORMConfig): Promise<ORMTreeItem[]> {
        try {
            const parser = new PrismaModelParserService(config.configPath!);
            const migrations = await parser.findMigrations();
            
            // Check which are applied
            const appliedSet = await this.migrationStatusService.getPrismaAppliedMigrations();

            const items: ORMTreeItem[] = [];
            for (const migration of migrations) {
                const isApplied = appliedSet.has(migration.id);
                
                items.push({
                    id: `prisma_migration_${migration.id}`,
                    label: migration.name,
                    type: 'migration',
                    migration: { ...migration, isApplied },
                    status: isApplied ? 'applied' : 'pending',
                    ormType: 'prisma',
                    ormConfig: config,
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                });
            }

            return items;
        } catch (error) {
            console.error('[ORM View] Error loading Prisma migrations:', error);
            return [];
        }
    }

    private getQuickActions(ormType: ORMType, config: ORMConfig): ORMTreeItem[] {
        if (ormType === 'django') {
            return [
                {
                    id: 'django_makemigrations',
                    label: 'Make Migrations',
                    type: 'action',
                    ormType: 'django',
                    ormConfig: config,
                    action: 'makemigrations',
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                },
                {
                    id: 'django_migrate',
                    label: 'Run All Migrations',
                    type: 'action',
                    ormType: 'django',
                    ormConfig: config,
                    action: 'migrate',
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                },
                {
                    id: 'django_shell',
                    label: 'Open Shell',
                    type: 'action',
                    ormType: 'django',
                    ormConfig: config,
                    action: 'shell',
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }
            ];
        } else if (ormType === 'prisma') {
            return [
                {
                    id: 'prisma_pull',
                    label: 'Pull Schema from DB',
                    type: 'action',
                    ormType: 'prisma',
                    ormConfig: config,
                    action: 'pull',
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                },
                {
                    id: 'prisma_push',
                    label: 'Push Schema to DB',
                    type: 'action',
                    ormType: 'prisma',
                    ormConfig: config,
                    action: 'push',
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                },
                {
                    id: 'prisma_studio',
                    label: 'Open Studio',
                    type: 'action',
                    ormType: 'prisma',
                    ormConfig: config,
                    action: 'studio',
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }
            ];
        }
        return [];
    }
}

