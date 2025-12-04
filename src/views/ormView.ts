import * as vscode from 'vscode';
import { ORMDetectorService, ORMConfig, ORMType } from '../services/orms_and_migrations/orm.detector.service';
import { DjangoIntegrationService } from '../services/orms_and_migrations/django.integration.service';
import { PrismaIntegrationService } from '../services/orms_and_migrations/prisma.integration.service';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';
import { ORMTreeProviderEnhanced } from './ormViewEnhanced';

interface ORMTreeItem {
    id: string;
    label: string;
    type: 'root' | 'orm' | 'action';
    ormType?: ORMType;
    ormConfig?: ORMConfig;
    action?: string;
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
        this.contextValue = item.type === 'action' ? `${item.ormType}_${item.action}` : item.type;
        
        // Set command for action items
        if (item.type === 'action' && item.action && item.ormType) {
            this.command = {
                command: `neonLocal.orm.${item.ormType}.${item.action}`,
                title: item.label,
                arguments: [item]
            };
        }
    }

    private getTooltip(): string {
        const { item } = this;
        if (item.type === 'orm' && item.ormConfig) {
            return `${item.ormConfig.name}\nProject: ${item.ormConfig.projectRoot || 'Detected'}`;
        } else if (item.type === 'action') {
            return `Click to ${item.label.toLowerCase()}`;
        }
        return item.label;
    }

    private getDescription(): string | undefined {
        const { item } = this;
        if (item.type === 'orm' && item.ormConfig?.projectRoot) {
            return item.ormConfig.projectRoot.split('/').pop();
        }
        return undefined;
    }

    private getIcon(): vscode.ThemeIcon {
        const { item } = this;
        if (item.type === 'orm' && item.ormConfig) {
            return new vscode.ThemeIcon(item.ormConfig.icon);
        } else if (item.type === 'action') {
            // Action-specific icons
            if (item.action?.includes('migrate')) {
                return new vscode.ThemeIcon('database');
            } else if (item.action?.includes('generate')) {
                return new vscode.ThemeIcon('file-code');
            } else if (item.action?.includes('shell') || item.action?.includes('studio')) {
                return new vscode.ThemeIcon('terminal');
            } else if (item.action?.includes('pull')) {
                return new vscode.ThemeIcon('cloud-download');
            } else if (item.action?.includes('push')) {
                return new vscode.ThemeIcon('cloud-upload');
            }
            return new vscode.ThemeIcon('play');
        }
        return new vscode.ThemeIcon('folder');
    }
}

export class ORMTreeProvider implements vscode.TreeDataProvider<ORMTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ORMTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<ORMTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ORMTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private ormDetector: ORMDetectorService;
    private detectedORMs: ORMConfig[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schemaService: SchemaService
    ) {
        this.ormDetector = new ORMDetectorService();
        this.refresh();
    }

    refresh(): void {
        this.ormDetector.detectORMs().then(orms => {
            this.detectedORMs = orms;
            console.log(`[ORM View] Detected ${orms.length} ORM(s):`, orms.map(o => o.name).join(', '));
            this._onDidChangeTreeData.fire();
        }).catch(error => {
            console.error('[ORM View] Error detecting ORMs:', error);
            vscode.window.showErrorMessage(`Failed to detect ORMs: ${error}`);
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
                // Show a message if no ORMs detected
                return [{
                    id: 'no_orms',
                    label: 'No ORMs detected',
                    type: 'root' as const,
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }];
            }

            return this.detectedORMs.map(orm => ({
                id: `orm_${orm.type}`,
                label: orm.name,
                type: 'orm' as const,
                ormType: orm.type,
                ormConfig: orm,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
            }));
        } else if (element.type === 'orm' && element.ormType) {
            // ORM level - show actions
            return this.getORMActions(element.ormType, element.ormConfig!);
        }

        return [];
    }

    private getORMActions(ormType: ORMType, config: ORMConfig): ORMTreeItem[] {
        switch (ormType) {
            case 'django':
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
                        label: 'Run Migrations',
                        type: 'action',
                        ormType: 'django',
                        ormConfig: config,
                        action: 'migrate',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'django_showmigrations',
                        label: 'Show Migration Status',
                        type: 'action',
                        ormType: 'django',
                        ormConfig: config,
                        action: 'showmigrations',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'django_shell',
                        label: 'Open Django Shell',
                        type: 'action',
                        ormType: 'django',
                        ormConfig: config,
                        action: 'shell',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'django_inspectdb',
                        label: 'Generate Models from DB',
                        type: 'action',
                        ormType: 'django',
                        ormConfig: config,
                        action: 'inspectdb',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'django_test',
                        label: 'Run Tests',
                        type: 'action',
                        ormType: 'django',
                        ormConfig: config,
                        action: 'test',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    }
                ];

            case 'prisma':
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
                        label: 'Open Prisma Studio',
                        type: 'action',
                        ormType: 'prisma',
                        ormConfig: config,
                        action: 'studio',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'prisma_generate',
                        label: 'Generate Client',
                        type: 'action',
                        ormType: 'prisma',
                        ormConfig: config,
                        action: 'generate',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'prisma_migrate_dev',
                        label: 'Create Migration',
                        type: 'action',
                        ormType: 'prisma',
                        ormConfig: config,
                        action: 'migrate_dev',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'prisma_migrate_deploy',
                        label: 'Deploy Migrations',
                        type: 'action',
                        ormType: 'prisma',
                        ormConfig: config,
                        action: 'migrate_deploy',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'prisma_validate',
                        label: 'Validate Schema',
                        type: 'action',
                        ormType: 'prisma',
                        ormConfig: config,
                        action: 'validate',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    },
                    {
                        id: 'prisma_seed',
                        label: 'Seed Database',
                        type: 'action',
                        ormType: 'prisma',
                        ormConfig: config,
                        action: 'seed',
                        collapsibleState: vscode.TreeItemCollapsibleState.None
                    }
                ];

            default:
                return [{
                    id: `${ormType}_placeholder`,
                    label: 'Integration coming soon...',
                    type: 'action',
                    ormType: ormType,
                    ormConfig: config,
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }];
        }
    }
}

export class ORMViewProvider {
    private treeDataProvider: ORMTreeProviderEnhanced;

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schemaService: SchemaService
    ) {
        this.treeDataProvider = new ORMTreeProviderEnhanced(context, stateService, schemaService);

        // Register tree view
        const view = vscode.window.createTreeView('neonLocalORM', {
            treeDataProvider: this.treeDataProvider,
            showCollapseAll: true
        });

        context.subscriptions.push(view);

        // Register commands
        this.registerCommands();
    }

    private registerCommands(): void {
        // Refresh command
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.orm.refresh', () => {
                this.treeDataProvider.refresh();
            }),
            vscode.commands.registerCommand('neonLocal.orm.testDetection', async () => {
                const detector = new (await import('./services/orm.detector.service')).ORMDetectorService();
                const orms = await detector.detectORMs();
                
                if (orms.length === 0) {
                    vscode.window.showWarningMessage('No ORMs detected in workspace');
                } else {
                    const message = `Found ${orms.length} ORM(s):\n${orms.map(o => `- ${o.name} (${o.configPath || o.projectRoot})`).join('\n')}`;
                    vscode.window.showInformationMessage(message);
                }
                
                console.log('[ORM Test] Detection results:', orms);
            }),
            
            // Model and migration file commands
            vscode.commands.registerCommand('neonLocal.orm.openModelFile', async (item: any) => {
                if (item.model && item.model.filePath) {
                    const doc = await vscode.workspace.openTextDocument(item.model.filePath);
                    await vscode.window.showTextDocument(doc);
                }
            }),
            
            vscode.commands.registerCommand('neonLocal.orm.openMigrationFile', async (item: any) => {
                if (item.migration && item.migration.filePath) {
                    const doc = await vscode.workspace.openTextDocument(item.migration.filePath);
                    await vscode.window.showTextDocument(doc);
                }
            }),
            
            vscode.commands.registerCommand('neonLocal.orm.viewModelTable', async (item: any) => {
                if (item.model) {
                    // Jump to table in schema view
                    vscode.window.showInformationMessage(`Opening table: ${item.model.tableName}`);
                    // Could trigger schema view to expand to this table
                }
            }),
            
            vscode.commands.registerCommand('neonLocal.orm.compareModelWithDB', async (item: any) => {
                if (item.model) {
                    vscode.window.showInformationMessage(`Comparing model ${item.model.name} with database...`);
                    // Would show diff in webview
                }
            })
        );

        // Django commands
        this.registerDjangoCommands();

        // Prisma commands
        this.registerPrismaCommands();
    }

    private registerDjangoCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.orm.django.makemigrations', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new DjangoIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                const appName = await vscode.window.showInputBox({
                    prompt: 'Enter Django app name (optional, leave empty for all apps)',
                    placeHolder: 'myapp'
                });
                
                await service.makeMigrations(appName || undefined);
            }),

            vscode.commands.registerCommand('neonLocal.orm.django.migrate', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new DjangoIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                // Show picker for app selection
                const options = [
                    { label: '$(rocket) Run All Migrations', description: 'Migrate all apps', appName: undefined },
                    { label: '$(edit) Specify App Name', description: 'Migrate specific app', appName: 'input' }
                ];
                
                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: 'Select migration option'
                });
                
                if (!selected) {
                    return;
                }
                
                let appName: string | undefined;
                if (selected.appName === 'input') {
                    appName = await vscode.window.showInputBox({
                        prompt: 'Enter Django app name',
                        placeHolder: 'myapp'
                    });
                    if (!appName) {
                        return;
                    }
                } else {
                    appName = selected.appName;
                }
                
                await service.runMigrations(appName);
            }),

            vscode.commands.registerCommand('neonLocal.orm.django.showmigrations', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new DjangoIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.showMigrationStatus();
            }),

            vscode.commands.registerCommand('neonLocal.orm.django.shell', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new DjangoIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.openShell();
            }),

            vscode.commands.registerCommand('neonLocal.orm.django.inspectdb', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new DjangoIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                const tableName = await vscode.window.showInputBox({
                    prompt: 'Enter table name (optional, leave empty for all tables)',
                    placeHolder: 'users'
                });
                
                await service.generateModelFromTable(tableName || '');
            }),

            vscode.commands.registerCommand('neonLocal.orm.django.test', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new DjangoIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                const testPath = await vscode.window.showInputBox({
                    prompt: 'Enter test path (optional, leave empty for all tests)',
                    placeHolder: 'myapp.tests.TestMyModel'
                });
                
                await service.runTests(undefined, testPath || undefined);
            })
        );
    }

    private registerPrismaCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.orm.prisma.pull', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.dbPull();
            }),

            vscode.commands.registerCommand('neonLocal.orm.prisma.push', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.dbPush();
            }),

            vscode.commands.registerCommand('neonLocal.orm.prisma.studio', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.openStudio();
            }),

            vscode.commands.registerCommand('neonLocal.orm.prisma.generate', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.generateClient();
            }),

            vscode.commands.registerCommand('neonLocal.orm.prisma.migrate_dev', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.migrateDev();
            }),

            vscode.commands.registerCommand('neonLocal.orm.prisma.migrate_deploy', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.migrateDeploy();
            }),

            vscode.commands.registerCommand('neonLocal.orm.prisma.validate', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.validateSchema();
            }),

            vscode.commands.registerCommand('neonLocal.orm.prisma.seed', async (item: ORMTreeItem) => {
                const config = item.ormConfig!;
                const service = new PrismaIntegrationService(
                    this.stateService,
                    config.projectRoot!,
                    config.configPath!
                );
                
                await service.seedDatabase();
            })
        );
    }
}

