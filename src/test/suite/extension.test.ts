import * as assert from 'assert';
import * as vscode from 'vscode';
import { NeonLocalManager } from '../../types';
import { NeonLocalExtension } from '../../extension';

console.debug('Loading test file...');

describe('Extension Test Suite', () => {
    console.debug('Setting up test suite...');
    let manager: NeonLocalManager;

    before(async () => {
        console.debug('Running before hook...');
        // List all installed extensions
        const extensions = vscode.extensions.all;
        console.debug('Installed extensions:', extensions.map(ext => ext.id));
    });

    after(() => {
        console.debug('Running after hook...');
    });

    it('should pass basic array test', () => {
        console.debug('Running basic array test...');
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });

    it('should have the extension present', async () => {
        console.debug('Checking for extension...');
        // List all extensions again to see what's available
        const allExtensions = vscode.extensions.all;
        console.debug('Available extensions:', allExtensions.map(ext => ext.id));
        
        // Try to find our extension with the correct ID
        const ext = vscode.extensions.getExtension('undefined_publisher.neon-local-connect');
        console.debug('Found extension:', ext?.id);
        
        if (!ext) {
            console.error('Extension not found. Available extensions:', allExtensions.map(ext => ext.id));
        }
        
        assert.ok(ext, 'Extension should be present');
    });

    it('should activate the extension', async () => {
        console.debug('Attempting to activate extension...');
        const ext = vscode.extensions.getExtension('undefined_publisher.neon-local-connect');
        assert.ok(ext, 'Extension should be present');
        
        try {
            await ext?.activate();
            assert.strictEqual(ext?.isActive, true, 'Extension should be active');
            console.debug('Extension activated successfully');
        } catch (error) {
            console.error('Error activating extension:', error);
            throw error;
        }
    });

    it('should register commands', async () => {
        console.debug('Checking registered commands...');
        const commands = await vscode.commands.getCommands(true);
        console.debug('All registered commands:', commands);
        
        const neonCommands = commands.filter(cmd => cmd.startsWith('neon-local-connect.'));
        console.debug('Found Neon commands:', neonCommands);
        
        // Check for specific commands we know should be registered
        const expectedCommands = [
            'neon-local-connect.configure',
            'neon-local-connect.showPanel',
            'neon-local-connect.clearAuth'
        ];
        
        expectedCommands.forEach(cmd => {
            assert.ok(neonCommands.includes(cmd), `Command ${cmd} should be registered`);
        });
    });

    describe('UI Behavior Tests', () => {
        let notifications: string[] = [];
        let originalShowInformationMessage: typeof vscode.window.showInformationMessage;

        beforeEach(() => {
            // Store original method
            originalShowInformationMessage = vscode.window.showInformationMessage;
            // Mock showInformationMessage to track notifications
            vscode.window.showInformationMessage = (message: string) => {
                notifications.push(message);
                return Promise.resolve(undefined);
            };
            notifications = [];
        });

        afterEach(() => {
            // Restore original method
            vscode.window.showInformationMessage = originalShowInformationMessage;
        });

        it('should show notification only once when starting proxy', async () => {
            // Mock the necessary methods and properties
            const mockWebview = {
                postMessage: () => Promise.resolve()
            };
            const mockDocker = {
                getContainer: () => Promise.resolve({
                    inspect: () => Promise.resolve({ State: { Running: true } }),
                    stop: () => Promise.resolve(),
                    remove: () => Promise.resolve(),
                    logs: () => Promise.resolve({
                        on: () => {}
                    })
                }),
                createContainer: () => Promise.resolve({
                    start: () => Promise.resolve(),
                    logs: () => Promise.resolve({
                        on: () => {}
                    })
                }),
                ping: () => Promise.resolve(),
                listContainers: () => Promise.resolve([])
            };

            // Create a mock ExtensionContext with state
            const mockContext: vscode.ExtensionContext = {
                subscriptions: [],
                workspaceState: {
                    get: () => undefined,
                    update: () => Promise.resolve(),
                    keys: () => []
                },
                globalState: {
                    get: (key: string) => {
                        console.debug('Getting state for key:', key);
                        if (key === 'neonLocal.currentProject') {
                            return 'test-project';
                        }
                        return undefined;
                    },
                    update: () => Promise.resolve(),
                    keys: () => ['neonLocal.currentProject'],
                    setKeysForSync: () => {}
                },
                extensionPath: '',
                globalStoragePath: '',
                logPath: '',
                storagePath: '',
                extensionUri: vscode.Uri.file(''),
                environmentVariableCollection: {
                    persistent: true,
                    description: '',
                    replace: () => {},
                    append: () => {},
                    prepend: () => {},
                    get: () => undefined,
                    forEach: () => {},
                    delete: () => {},
                    clear: () => {},
                    getScoped: () => ({
                        persistent: true,
                        description: '',
                        replace: () => {},
                        append: () => {},
                        prepend: () => {},
                        get: () => undefined,
                        forEach: () => {},
                        delete: () => {},
                        clear: () => {},
                        [Symbol.iterator]: function* () {
                            yield* [];
                        }
                    }),
                    [Symbol.iterator]: function* () {
                        yield* [];
                    }
                },
                extensionMode: vscode.ExtensionMode.Production,
                asAbsolutePath: (relativePath: string) => relativePath,
                storageUri: vscode.Uri.file(''),
                globalStorageUri: vscode.Uri.file(''),
                logUri: vscode.Uri.file(''),
                languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
                extension: {} as vscode.Extension<any>,
                secrets: {} as vscode.SecretStorage
            };

            // Create a test instance with mocked dependencies
            const testManager = new NeonLocalExtension(mockContext);
            (testManager as any).docker = mockDocker;
            (testManager as any).getActiveWebview = () => mockWebview;
            
            // Debug log the state
            console.debug('Test manager state:', {
                currentProject: (testManager as any).currentProject,
                currentOrg: (testManager as any).currentOrg,
                currentBranch: (testManager as any).currentBranch
            });

            // Start the proxy using handleStartProxy (existing branch)
            await testManager.handleStartProxy('postgres', true, 'test-branch', undefined);

            // Verify that the notification was shown exactly once
            assert.strictEqual(notifications.length, 1, 'Should show exactly one notification');
            assert.strictEqual(notifications[0], 'Neon Local Connect proxy started successfully', 'Should show correct notification message');
        });

        it('should update UI state correctly when starting proxy', async () => {
            const webviewMessages: any[] = [];
            const mockWebview = {
                postMessage: (message: any) => {
                    webviewMessages.push(message);
                    return Promise.resolve();
                }
            };
            const mockDocker = {
                getContainer: () => Promise.resolve({
                    inspect: () => Promise.resolve({ State: { Running: true } }),
                    stop: () => Promise.resolve(),
                    remove: () => Promise.resolve(),
                    logs: () => Promise.resolve({
                        on: () => {}
                    })
                }),
                createContainer: () => Promise.resolve({
                    start: () => Promise.resolve(),
                    logs: () => Promise.resolve({
                        on: () => {}
                    })
                }),
                ping: () => Promise.resolve(),
                listContainers: () => Promise.resolve([])
            };

            // Create a mock ExtensionContext
            const mockContext: vscode.ExtensionContext = {
                subscriptions: [],
                workspaceState: {
                    get: () => undefined,
                    update: () => Promise.resolve(),
                    keys: () => []
                },
                globalState: {
                    get: (key: string) => {
                        console.debug('Getting state for key:', key);
                        if (key === 'neonLocal.currentProject') {
                            return 'test-project';
                        }
                        return undefined;
                    },
                    update: () => Promise.resolve(),
                    keys: () => ['neonLocal.currentProject'],
                    setKeysForSync: () => {}
                },
                extensionPath: '',
                globalStoragePath: '',
                logPath: '',
                storagePath: '',
                extensionUri: vscode.Uri.file(''),
                environmentVariableCollection: {
                    persistent: true,
                    description: '',
                    replace: () => {},
                    append: () => {},
                    prepend: () => {},
                    get: () => undefined,
                    forEach: () => {},
                    delete: () => {},
                    clear: () => {},
                    getScoped: () => ({
                        persistent: true,
                        description: '',
                        replace: () => {},
                        append: () => {},
                        prepend: () => {},
                        get: () => undefined,
                        forEach: () => {},
                        delete: () => {},
                        clear: () => {},
                        [Symbol.iterator]: function* () {
                            yield* [];
                        }
                    }),
                    [Symbol.iterator]: function* () {
                        yield* [];
                    }
                },
                extensionMode: vscode.ExtensionMode.Production,
                asAbsolutePath: (relativePath: string) => relativePath,
                storageUri: vscode.Uri.file(''),
                globalStorageUri: vscode.Uri.file(''),
                logUri: vscode.Uri.file(''),
                languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
                extension: {} as vscode.Extension<any>,
                secrets: {} as vscode.SecretStorage
            };

            // Create a test instance with mocked dependencies
            const testManager = new NeonLocalExtension(mockContext);
            (testManager as any).docker = mockDocker;
            (testManager as any).getActiveWebview = () => mockWebview;

            // Start the proxy using handleStartProxy (existing branch)
            await testManager.handleStartProxy('postgres', true, 'test-branch', undefined);

            // Verify that the UI was updated correctly
            const statusUpdate = webviewMessages.find(msg => msg.command === 'updateStatus');
            assert.ok(statusUpdate, 'Should send status update message');
            assert.strictEqual(statusUpdate.connected, true, 'Should set connected state to true');
            assert.strictEqual(statusUpdate.branch, 'test-branch', 'Should set correct branch');
            assert.strictEqual(statusUpdate.loading, false, 'Should set loading to false');
            assert.ok(statusUpdate.connectionInfo, 'Should include connection info');
        });

        it('should create a new branch and start proxy', async () => {
            const webviewMessages: any[] = [];
            const mockWebview = {
                postMessage: (message: any) => {
                    webviewMessages.push(message);
                    return Promise.resolve();
                }
            };
            const mockDocker = {
                getContainer: () => Promise.resolve({
                    inspect: () => Promise.resolve({ State: { Running: true } }),
                    stop: () => Promise.resolve(),
                    remove: () => Promise.resolve(),
                    logs: () => Promise.resolve({
                        on: () => {}
                    })
                }),
                createContainer: () => Promise.resolve({
                    start: () => Promise.resolve(),
                    logs: () => Promise.resolve({
                        on: () => {}
                    })
                }),
                ping: () => Promise.resolve(),
                listContainers: () => Promise.resolve([])
            };

            // Mock API client
            const mockApiClient = {
                post: async (url: string, payload: any) => {
                    // Simulate branch creation response
                    return {
                        data: {
                            branch: {
                                id: 'new-branch-id',
                                name: payload.branch.name,
                                parent_id: payload.branch.parent_id
                            }
                        }
                    };
                }
            };

            // Create a mock ExtensionContext
            const mockContext: vscode.ExtensionContext = {
                subscriptions: [],
                workspaceState: {
                    get: () => undefined,
                    update: () => Promise.resolve(),
                    keys: () => []
                },
                globalState: {
                    get: (key: string) => {
                        if (key === 'neonLocal.currentProject') {
                            return 'test-project';
                        }
                        return undefined;
                    },
                    update: () => Promise.resolve(),
                    keys: () => ['neonLocal.currentProject'],
                    setKeysForSync: () => {}
                },
                extensionPath: '',
                globalStoragePath: '',
                logPath: '',
                storagePath: '',
                extensionUri: vscode.Uri.file(''),
                environmentVariableCollection: {
                    persistent: true,
                    description: '',
                    replace: () => {},
                    append: () => {},
                    prepend: () => {},
                    get: () => undefined,
                    forEach: () => {},
                    delete: () => {},
                    clear: () => {},
                    getScoped: () => ({
                        persistent: true,
                        description: '',
                        replace: () => {},
                        append: () => {},
                        prepend: () => {},
                        get: () => undefined,
                        forEach: () => {},
                        delete: () => {},
                        clear: () => {},
                        [Symbol.iterator]: function* () {
                            yield* [];
                        }
                    }),
                    [Symbol.iterator]: function* () {
                        yield* [];
                    }
                },
                extensionMode: vscode.ExtensionMode.Production,
                asAbsolutePath: (relativePath: string) => relativePath,
                storageUri: vscode.Uri.file(''),
                globalStorageUri: vscode.Uri.file(''),
                logUri: vscode.Uri.file(''),
                languageModelAccessInformation: {} as vscode.LanguageModelAccessInformation,
                extension: {} as vscode.Extension<any>,
                secrets: {} as vscode.SecretStorage
            };

            // Create a test instance with mocked dependencies
            const testManager = new NeonLocalExtension(mockContext);
            (testManager as any).docker = mockDocker;
            (testManager as any).getActiveWebview = () => mockWebview;
            (testManager as any).getNeonApiClient = async () => mockApiClient;
            (testManager as any).updateViewData = async () => {};
            (testManager as any).saveState = async () => {};

            // Mock input box for branch name
            const originalShowInputBox = vscode.window.showInputBox;
            vscode.window.showInputBox = async () => 'feature/test-branch';

            // Mock showInformationMessage
            const infoMessages: string[] = [];
            const originalShowInformationMessage = vscode.window.showInformationMessage;
            vscode.window.showInformationMessage = (msg: string) => {
                infoMessages.push(msg);
                return Promise.resolve(undefined);
            };

            // Call handleStartProxy with isExisting=false to simulate creating a new branch
            await testManager.handleStartProxy('postgres', false, undefined, 'parent-branch-id');

            // Restore mocks
            vscode.window.showInputBox = originalShowInputBox;
            vscode.window.showInformationMessage = originalShowInformationMessage;

            // Assert that the proxy was started
            assert.ok(infoMessages.some(msg => msg.includes('started successfully')), 'Should show proxy started notification');
            // Optionally, check that the proxy was started (could check webviewMessages or other side effects)
        });
    });
}); 