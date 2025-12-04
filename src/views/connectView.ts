import * as vscode from 'vscode';
import { ConfigurationManager, Logger } from '../utils';
import { DEBOUNCE_DELAY, VIEW_TYPES } from '../constants';
import { ViewData, WebviewMessage, NeonOrg, NeonProject, NeonBranch } from '../types';
import * as path from 'path';
import { WebViewService } from '../services/webview.service';
import { StateService } from '../services/state.service';
import { NeonApiService } from '../services/api.service';
import { SignInView } from './SignInView';
import { AuthManager } from '../auth/authManager';

export class ConnectViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.CONNECT;
    private _view?: vscode.WebviewView;
    private _updateViewTimeout?: NodeJS.Timeout;
    private _isUpdating = false;
    private _lastRequestedConnectionType?: 'existing' | 'new';
    private _connectionTypeUpdateTimeout?: NodeJS.Timeout;
    private readonly _extensionUri: vscode.Uri;
    private readonly _webviewService: WebViewService;
    private readonly _stateService: StateService;
    private readonly _extensionContext: vscode.ExtensionContext;
    private _lastUpdateData?: ViewData;
    private _signInView?: SignInView;
    private readonly _authManager: AuthManager;
    private _lastKnownToken?: string;
    private _authStateChangeDisposable?: vscode.Disposable;

    constructor(
        extensionUri: vscode.Uri,
        webviewService: WebViewService,
        stateService: StateService,
        extensionContext: vscode.ExtensionContext
    ) {
        this._extensionUri = extensionUri;
        this._webviewService = webviewService;
        this._stateService = stateService;
        this._extensionContext = extensionContext;
        this._authManager = AuthManager.getInstance(extensionContext);

        // Listen for authentication state changes
        this._authStateChangeDisposable = this._authManager.onDidChangeAuthentication(async (isAuthenticated) => {
            if (isAuthenticated) {
                // User has signed in or imported a token, initialize the view
                await this.initializeViewData();
                if (this._view) {
                    this._view.webview.html = this.getWebviewContent(this._view.webview);
                }
            } else {
                // User has signed out, clear state and show sign-in
                await this._stateService.clearState();
                if (this._view && this._signInView) {
                    this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your database", true);
                }
            }
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            enableCommandUris: false,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Set up message handler
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            await this.handleWebviewMessage(message);
        });

        // Create sign-in view
        this._signInView = new SignInView(webviewView.webview, this._stateService, this._authManager);

        // Register this view with the manager
        const viewId = this._webviewService.registerWebview(webviewView.webview, 'connectView');
        console.debug(`ConnectViewProvider: Registered webview with ID: ${viewId}`);

        // Initial update with a small delay to ensure proper registration
        setTimeout(async () => {
            try {
                // Ensure AuthManager has completed initialization (incl. silent refresh)
                await this._authManager.ready();
                const isAuthenticated = await this._authManager.isAuthenticatedAsync();
                console.debug('ConnectViewProvider: Authentication state check', { isAuthenticated });

                if (!isAuthenticated) {
                    console.debug('ConnectViewProvider: Not authenticated, showing sign-in');
                    if (this._view && this._signInView) {
                        this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your database", true);
                    }
                    return;
                }

                // User is authenticated (either via OAuth or persistent API key), show connect view and initialize
                console.debug('ConnectViewProvider: User is authenticated, showing connect view');
                if (this._view) {
                    this._view.webview.html = this.getWebviewContent(this._view.webview);
                }
                await this.initializeViewData();
            } catch (error) {
                console.error('Error in initial view update:', error);
                if (error instanceof Error) {
                    vscode.window.showErrorMessage(`View initialization error: ${error.message}`);
                }
            }
        }, 100);
    }

    private async initializeViewData(): Promise<void> {
        const apiService = new NeonApiService(this._extensionContext);

        // Start loading organizations
        await this._stateService.updateLoadingState({
            orgs: true,
            projects: true,
            branches: true
        });

        try {
            // Fetch organizations first
            console.debug('initializeViewData: About to call getOrgs()');
            const orgs = await apiService.getOrgs();
            console.debug('initializeViewData: getOrgs() returned', { orgCount: orgs.length });
            
            // Check if organizations have changed (indicating different user)
            const currentViewData = await this._stateService.getViewData();
            const currentOrgs = currentViewData.orgs;
            
            // Compare organization IDs to detect if user has changed
            const currentOrgIds = currentOrgs.map(org => org.id).sort();
            const newOrgIds = orgs.map(org => org.id).sort();
            
            const orgsChanged = currentOrgs.length > 0 && 
                               (currentOrgIds.length !== newOrgIds.length || 
                                !currentOrgIds.every((id, index) => id === newOrgIds[index]));
            
            if (orgsChanged) {
                console.debug('Different organizations detected after sign-in, clearing state');
                await this._stateService.clearState();
            }
            
            await this._stateService.setOrganizations(orgs);
            await this._stateService.updateLoadingState({
                orgs: false
            });

            // Only fetch projects if there's a valid organization selected
            const currentOrgId = this._stateService.currentOrg;
            if (currentOrgId && currentOrgId !== '') {
                try {
                    const projects = await apiService.getProjects(currentOrgId);
                    await this._stateService.setProjects(projects);
                    await this._stateService.updateLoadingState({
                        projects: false
                    });

                    // If there's a pre-selected project, fetch its branches
                    const currentProjectId = this._stateService.currentProject;
                    if (currentProjectId) {
                        try {
                            const branches = await apiService.getBranches(currentProjectId);
                            await this._stateService.setBranches(branches);
                        } catch (error) {
                            console.error('Error fetching branches for pre-selected project:', error);
                            if (error instanceof Error) {
                                vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error fetching projects for pre-selected organization:', error);
                    if (error instanceof Error) {
                        vscode.window.showErrorMessage(`Failed to fetch projects: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching organizations:', error);
            if (error instanceof Error) {
                const errorMessage = error.message;
                vscode.window.showErrorMessage(`Failed to fetch organizations: ${errorMessage}`);
                
                // If timeout, suggest checking network
                if (errorMessage.includes('timeout')) {
                    vscode.window.showWarningMessage(
                        'The request to Neon API timed out. Please check your network connection or try again later.'
                    );
                }
            }
        }

        // Clear loading states
        await this._stateService.updateLoadingState({
            orgs: false,
            projects: false,
            branches: false
        });
        
        // Update view
        await this.updateView();
    }

    private debouncedUpdateView = () => {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        this._updateViewTimeout = setTimeout(() => {
            this.updateView();
        }, DEBOUNCE_DELAY);
    };

    private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'signIn':
                    if (this._signInView) {
                        await this._signInView.handleSignIn();
                        // The authentication state change listener will handle the UI update
                        // After sign-in completes, also update stateService with the persistent token
                        const persistentToken = await this._authManager.getPersistentApiToken();
                        if (persistentToken) {
                            console.debug('ConnectViewProvider: Updating stateService with persistent API token');
                            await this._stateService.setPersistentApiToken(persistentToken);
                        }
                        // Explicitly refresh the view after sign-in completes
                        if (this._authManager.isAuthenticated && this._view) {
                            console.debug('ConnectViewProvider: Explicitly refreshing view after sign-in');
                            await this.initializeViewData();
                            this._view.webview.html = this.getWebviewContent(this._view.webview);
                        }
                    }
                    break;
                case 'showLoading':
                case 'resetSignIn':
                case 'showError':
                    this._signInView?.handleMessage(message);
                    break;
                case 'importToken':
                    const token = await vscode.window.showInputBox({
                        prompt: 'Enter your Neon persistent API token',
                        password: true,
                        ignoreFocusOut: true
                    });

                    if (token) {
                        // Validate the token by making an API call
                        console.debug('🔍 Validating imported API token...');
                        
                        try {
                            // Show progress while validating
                            await vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                                title: "Validating API token...",
                                cancellable: false
                            }, async (progress) => {
                                // Create API service and test the token directly (no storage needed)
                                const testApiService = new NeonApiService(this._extensionContext);
                                
                                console.debug('📡 Testing API token with validation call...');
                                const isValid = await testApiService.validateToken(token);
                                
                                if (!isValid) {
                                    throw new Error('Invalid API token');
                                }
                                
                                console.debug('✅ API token validation successful');
                                
                                // Token is valid, proceed with storing it permanently
                                await this._authManager.setPersistentApiToken(token);
                                await this._stateService.setPersistentApiToken(token);
                                
                                console.debug('✅ API token imported and stored successfully');
                            });
                            
                            // The authentication state change listener will handle the UI update
                            
                        } catch (error) {
                            console.error('❌ API token validation failed:', error);
                            
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            vscode.window.showErrorMessage(
                                `Invalid API token: ${errorMessage}. Please check your token and try again.`
                            );
                            
                            // Don't store the invalid token
                            console.debug('❌ API token not imported due to validation failure');
                        }
                    }
                    break;
                case 'clearAuth':
                    // Show sign-in view without clearing state
                    if (this._view && this._signInView) {
                        this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your database", true);
                    }
                    break;
                case 'openNeonConsole':
                    await vscode.env.openExternal(vscode.Uri.parse(`https://console.neon.tech${message.path}`));
                    break;
                case 'selectOrg':
                    // Get current state data
                    const viewData = await this._stateService.getViewData();
                    const selectedOrg = viewData.orgs.find((org: NeonOrg) => org.id === message.orgId);
                    if (!selectedOrg) {
                        console.error('Selected org not found:', message.orgId);
                        vscode.window.showErrorMessage('Selected organization not found');
                        return;
                    }
                    
                    // Clear all downstream selections
                    await this._stateService.updateState({
                        selection: {
                            orgs: viewData.orgs,
                            projects: [],
                            branches: [],
                            selectedOrgId: message.orgId,
                            selectedOrgName: selectedOrg.name,
                            selectedProjectId: undefined,
                            selectedProjectName: undefined,
                            selectedBranchId: undefined,
                            selectedBranchName: undefined,
                            parentBranchId: undefined,
                            parentBranchName: undefined
                        }
                    });
                    
                    // Fetch projects for the selected organization
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        const projects = await apiService.getProjects(message.orgId);
                        await this._stateService.setProjects(projects);
                    } catch (error) {
                        console.error('Error fetching projects:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch projects: ${error.message}`);
                        }
                    }
                    
                    // Force UI refresh to clear dropdowns
                    await this.updateView();
                    break;
                case 'selectProject':
                    // Get current state data
                    const currentState = await this._stateService.getViewData();
                    const selectedProject = currentState.projects.find((project: NeonProject) => project.id === message.projectId);
                    if (!selectedProject) {
                        console.error('Selected project not found:', message.projectId);
                        vscode.window.showErrorMessage('Selected project not found');
                        return;
                    }
                    // Clear branch selections and update project selection
                    await this._stateService.updateState({
                        selection: {
                            orgs: currentState.orgs,
                            projects: currentState.projects,
                            branches: [],
                            selectedOrgId: currentState.selectedOrgId || '',
                            selectedOrgName: currentState.selectedOrgName || '',
                            selectedProjectId: message.projectId,
                            selectedProjectName: selectedProject.name,
                            selectedBranchId: undefined,
                            selectedBranchName: undefined,
                            parentBranchId: undefined,
                            parentBranchName: undefined
                        }
                    });
                    
                    // Also clear the current branch to ensure container gets the right branch ID later
                    await this._stateService.setCurrentBranch('');
                    await this._stateService.setParentBranchId('');
                    
                    // Fetch branches for the selected project
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        const branches = await apiService.getBranches(message.projectId);
                        await this._stateService.setBranches(branches);
                        
                        // After loading branches, check if there's a previously selected branch for this project
                        // that should be restored and properly synchronized
                        const updatedState = await this._stateService.getViewData();
                        if (updatedState.selectedBranchId && updatedState.connectionType === 'existing') {
                            // Verify the branch still exists in the project
                            const branchExists = branches.find(branch => branch.id === updatedState.selectedBranchId);
                            if (branchExists) {
                                console.debug('Restoring previously selected branch for project:', updatedState.selectedBranchId);
                                // Update the state to ensure branch name is correct AND sync the backend current branch
                                await this._stateService.setCurrentBranch(updatedState.selectedBranchId);
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        selectedBranchName: branchExists.name
                                    }
                                });
                            } else {
                                // Branch no longer exists, clear the selection
                                console.debug('Previously selected branch no longer exists, clearing selection');
                                await this._stateService.setCurrentBranch('');
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        selectedBranchId: undefined,
                                        selectedBranchName: undefined
                                    }
                                });
                            }
                        } else if (updatedState.parentBranchId && updatedState.connectionType === 'new') {
                            // Handle parent branch restoration for new connection type
                            const branchExists = branches.find(branch => branch.id === updatedState.parentBranchId);
                            if (branchExists) {
                                console.debug('Restoring previously selected parent branch for project:', updatedState.parentBranchId);
                                // Sync the backend parent branch state
                                await this._stateService.setParentBranchId(updatedState.parentBranchId);
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        parentBranchName: branchExists.name
                                    }
                                });
                            } else {
                                console.debug('Previously selected parent branch no longer exists, clearing selection');
                                await this._stateService.setParentBranchId('');
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        parentBranchId: undefined,
                                        parentBranchName: undefined
                                    }
                                });
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching branches:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
                        }
                    }
                    await this.updateView();
                    break;
                case 'selectBranch':
                    const branchState = await this._stateService.getViewData();
                    const selectedBranch = branchState.branches.find((branch: NeonBranch) => branch.id === message.branchId);
                    if (!selectedBranch) {
                        console.error('Selected branch not found:', message.branchId);
                        vscode.window.showErrorMessage('Selected branch not found');
                        return;
                    }

                    // Handle both regular branch and parent branch selection based on connection type
                    if (branchState.connectionType === 'existing') {
                        await this._stateService.setCurrentBranch(message.branchId);
                        await this._stateService.updateState({
                            selection: {
                                orgs: branchState.orgs,
                                projects: branchState.projects,
                                branches: branchState.branches,
                                selectedOrgId: branchState.selectedOrgId || '',
                                selectedOrgName: branchState.selectedOrgName || '',
                                selectedProjectId: branchState.selectedProjectId,
                                selectedProjectName: branchState.selectedProjectName,
                                selectedBranchId: message.branchId,
                                selectedBranchName: selectedBranch.name,
                                parentBranchId: branchState.parentBranchId,
                                parentBranchName: branchState.parentBranchName
                            }
                        });
                    } else {
                        await this._stateService.setParentBranchId(message.branchId);
                        await this._stateService.updateState({
                            selection: {
                                orgs: branchState.orgs,
                                projects: branchState.projects,
                                branches: branchState.branches,
                                selectedOrgId: branchState.selectedOrgId || '',
                                selectedOrgName: branchState.selectedOrgName || '',
                                selectedProjectId: branchState.selectedProjectId,
                                selectedProjectName: branchState.selectedProjectName,
                                selectedBranchId: branchState.selectedBranchId,
                                selectedBranchName: branchState.selectedBranchName,
                                parentBranchId: message.branchId,
                                parentBranchName: selectedBranch.name
                            }
                        });
                    }
                    await this.updateView();
                    break;

                case 'updatePort':
                    await this._stateService.setPort(message.port);
                    await this.updateView();
                    break;
                case 'startProxy':
                    await this._stateService.setIsStarting(true);
                    try {
                        // Show notification that we're connecting
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Connecting to your Neon database",
                            cancellable: false
                        }, async (progress) => {
                            try {
                                // Get the current state before connecting
                                const currentState = await this._stateService.getViewData();
                                
                                progress.report({ message: "Fetching connection information..." });
                                
                                // Get branch ID from message
                                const branchId = message.branchId;
                                const projectId = this._stateService.currentProject;
                                
                                console.debug('🔍 Connecting to branch:', branchId, 'project:', projectId);

                                // Set currently connected branch and current branch
                                await this._stateService.setCurrentlyConnectedBranch(branchId);
                                await this._stateService.setCurrentBranch(message.branchId);

                                // Fetch connection info, databases, and roles from Neon API
                                const apiService = new NeonApiService(this._extensionContext);
                                console.debug('🔍 Fetching connection info, databases, and roles...');
                                
                                const [connectionInfos, databases, roles] = await Promise.all([
                                    apiService.getBranchConnectionInfo(projectId, branchId),
                                    apiService.getDatabases(projectId, branchId),
                                    apiService.getRoles(projectId, branchId)
                                ]);

                                console.debug('✅ Fetched connection info:', connectionInfos);
                                console.debug('✅ Fetched databases:', databases);
                                console.debug('✅ Fetched roles:', roles);

                                // Store connection info in state
                                await this._stateService.setBranchConnectionInfos(connectionInfos);

                                // Build connection string for display (using first database)
                                const firstConnection = connectionInfos[0];
                                const connectionString = firstConnection 
                                    ? `postgresql://${firstConnection.user}:${firstConnection.password}@${firstConnection.host}/${firstConnection.database}?sslmode=require`
                                    : '';

                                progress.report({ message: "Updating connection state..." });

                                // Update the connection state
                                const currentFullState = await this._stateService.getViewData();
                                await this._stateService.updateState({
                                    selection: {
                                        orgs: currentState.orgs,
                                        projects: currentState.projects,
                                        branches: currentState.branches,
                                        selectedOrgId: currentState.selectedOrgId || '',
                                        selectedOrgName: currentState.selectedOrgName || '',
                                        selectedProjectId: currentState.selectedProjectId,
                                        selectedProjectName: currentState.selectedProjectName,
                                        selectedBranchId: currentState.selectedBranchId,
                                        selectedBranchName: currentState.selectedBranchName,
                                        parentBranchId: currentState.parentBranchId,
                                        parentBranchName: currentState.parentBranchName
                                    },
                                    connection: {
                                        ...currentFullState.connection,
                                        connected: true,
                                        connectionInfo: connectionString,
                                        databases,
                                        roles,
                                        connectedOrgId: currentState.selectedOrgId || '',
                                        connectedOrgName: currentState.selectedOrgName || '',
                                        connectedProjectId: currentState.selectedProjectId || '',
                                        connectedProjectName: currentState.selectedProjectName || '',
                                        branchConnectionInfos: connectionInfos,
                                        selectedDatabase: databases.length > 0 ? databases[0].name : ''
                                    }
                                });

                                // Mark as connected
                                await this._stateService.setIsProxyRunning(true);

                                // Update the view to reflect the connection
                                await this.updateView();
                                
                                vscode.window.showInformationMessage('Successfully connected to Neon database!');
                            } catch (progressError) {
                                // Re-throw the error to be handled by the outer catch block
                                throw progressError;
                            }
                        });
                    } catch (error) {
                        console.error('Error connecting to database:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
                        }
                    } finally {
                        await this._stateService.setIsStarting(false);
                        await this.updateView();
                    }
                    break;
                case 'stopProxy':
                    // Clear connection state
                    await this._stateService.setBranchConnectionInfos([]);
                    await this._stateService.setIsProxyRunning(false);
                    await this._stateService.setCurrentlyConnectedBranch('');
                    await this.updateView();
                    vscode.window.showInformationMessage('Disconnected from Neon database');
                    break;
                case 'selectConnectionDatabaseRole':
                    await this.handleSelectConnectionDatabaseRole(message.currentDatabase, message.currentRole);
                    break;
                case 'updateConnectionType':
                    console.debug('ConnectViewProvider: Handling connection type update:', {
                        newType: message.connectionType,
                        currentType: this._lastRequestedConnectionType
                    });
                    // Store the requested connection type
                    this._lastRequestedConnectionType = message.connectionType;
                    // Update the connection type through the state service
                    await this._stateService.setConnectionType(message.connectionType);
                    // Update the view to reflect the change
                    await this.updateView();
                    break;
                case 'requestInitialData':
                    await this.updateView();
                    break;
                case 'createNewBranch':
                    try {
                        // Show input box for branch name
                        const branchName = await vscode.window.showInputBox({
                            prompt: 'Enter a name for the new branch',
                            placeHolder: 'e.g., feature/my-new-branch',
                            validateInput: text => {
                                return text ? null : 'Branch name is required';
                            }
                        });

                        if (!branchName) {
                            return; // User cancelled
                        }

                        // Get current state for branch list
                        const currentState = await this._stateService.getViewData();
                        
                        // Create QuickPick for parent branch selection
                        const parentBranch = await vscode.window.showQuickPick(
                            currentState.branches.map(branch => ({
                                label: branch.name,
                                description: `Branch ID: ${branch.id}`,
                                detail: branch.name === 'main' ? '(Default parent branch)' : undefined,
                                id: branch.id
                            })), {
                                title: 'Select Parent Branch',
                                placeHolder: 'Choose a parent branch for the new branch',
                                ignoreFocusOut: true
                            }
                        );

                        if (!parentBranch) {
                            return; // User cancelled
                        }

                        try {
                            // Create the branch
                            const apiService = new NeonApiService(this._extensionContext);
                            const newBranch = await apiService.createBranch(message.projectId, parentBranch.id, branchName);
                            
                            // Refresh the branches list
                            const branches = await apiService.getBranches(message.projectId);
                            await this._stateService.setBranches(branches);
                            
                            // Select the new branch
                            await this._stateService.setCurrentBranch(newBranch.id);
                            await this._stateService.updateState({
                                selection: {
                                    orgs: currentState.orgs,
                                    projects: currentState.projects,
                                    branches: branches,
                                    selectedOrgId: currentState.selectedOrgId || '',
                                    selectedOrgName: currentState.selectedOrgName || '',
                                    selectedProjectId: currentState.selectedProjectId,
                                    selectedProjectName: currentState.selectedProjectName,
                                    selectedBranchId: newBranch.id,
                                    selectedBranchName: newBranch.name,
                                    parentBranchId: currentState.parentBranchId,
                                    parentBranchName: currentState.parentBranchName
                                }
                            });

                            // Update the view
                            await this.updateView();
                            
                            vscode.window.showInformationMessage(`Branch "${branchName}" created successfully.`);
                        } catch (error) {
                            console.error('Error creating new branch:', error);
                            if (error instanceof Error) {
                                vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error in branch creation flow:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling webview message:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
            }
        }
    }

    public dispose(): void {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        if (this._connectionTypeUpdateTimeout) {
            clearTimeout(this._connectionTypeUpdateTimeout);
        }
        this._authStateChangeDisposable?.dispose();
    }

    private async handleSelectConnectionDatabaseRole(currentDatabase: string, currentRole: string): Promise<void> {
        try {
            const viewData = await this._stateService.getViewData();
            const connectionInfos = viewData.connection.branchConnectionInfos;

            if (!connectionInfos || connectionInfos.length === 0) {
                vscode.window.showWarningMessage('No connection information available');
                return;
            }

            // Get unique databases
            const databases = Array.from(new Set(connectionInfos.map(info => info.database)));

            // Show database picker
            const selectedDatabase = await vscode.window.showQuickPick(
                databases.map(db => ({
                    label: db,
                    description: db === currentDatabase ? '(Current)' : undefined
                })),
                {
                    placeHolder: 'Select a database',
                    title: 'Select Database'
                }
            );

            if (!selectedDatabase) {
                return; // User cancelled
            }

            // Get roles for the selected database
            const rolesForDatabase = connectionInfos
                .filter(info => info.database === selectedDatabase.label)
                .map(info => info.user);

            const uniqueRoles = Array.from(new Set(rolesForDatabase));

            // Show role picker
            const selectedRole = await vscode.window.showQuickPick(
                uniqueRoles.map(role => ({
                    label: role,
                    description: role === currentRole && selectedDatabase.label === currentDatabase ? '(Current)' : undefined
                })),
                {
                    placeHolder: 'Select a role',
                    title: 'Select Role'
                }
            );

            if (!selectedRole) {
                return; // User cancelled
            }

            // Send the selected database and role back to the webview
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'updateConnectionDatabaseRole',
                    database: selectedDatabase.label,
                    role: selectedRole.label
                });
            }
        } catch (error) {
            console.error('Error selecting database/role:', error);
            vscode.window.showErrorMessage(`Failed to select database/role: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'styles.css')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource}; connect-src 'self';">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Neon Local Connect</title>
            </head>
            <body data-view-type="${VIEW_TYPES.CONNECT}">
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public async updateView(): Promise<void> {
        console.debug('ConnectViewProvider: Starting updateView');
        if (!this._view || this._isUpdating) {
            console.debug('ConnectViewProvider: Skipping update - view not ready or already updating');
            return;
        }

        this._isUpdating = true;
        console.debug('ConnectViewProvider: Set _isUpdating flag');

        try {
            // Use AuthManager to check authentication state consistently
            const isAuthenticated = await this._authManager.isAuthenticatedAsync();
            console.debug('ConnectViewProvider: Authentication state check in updateView', { isAuthenticated });

            if (!isAuthenticated) {
                console.debug('ConnectViewProvider: Not authenticated, showing sign-in message');
                if (this._view && this._signInView) {
                    this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your database", true);
                }
                return;
            }

            // User is authenticated (either via OAuth or persistent API key), show connect view
            console.debug('ConnectViewProvider: User is authenticated, showing connect view');
            if (this._view.webview.html.includes('sign-in-button')) {
                console.debug('ConnectViewProvider: Transitioning from sign-in to connect view');
                this._view.webview.html = this.getWebviewContent(this._view.webview);
                
                // Initialize state with empty selections
                await this._stateService.updateState({
                    selection: {
                        orgs: [],
                        projects: [],
                        branches: [],
                        selectedOrgId: '',
                        selectedOrgName: '',
                        selectedProjectId: undefined,
                        selectedProjectName: undefined,
                        selectedBranchId: undefined,
                        selectedBranchName: undefined,
                        parentBranchId: undefined,
                        parentBranchName: undefined
                    },
                    loading: {
                        orgs: false,
                        projects: false,
                        branches: false
                    }
                });
            }

            // Get the current view data
            console.debug('ConnectViewProvider: Getting view data');
            const viewData = await this._stateService.getViewData();
            await this._webviewService.updateWebview(this._view, viewData);
        } catch (error) {
            console.error('ConnectViewProvider: Error updating view', error);
            Logger.error('Failed to update view', error);
            
            if (this._view && this._signInView) {
                this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your database", true);
            }
        } finally {
            this._isUpdating = false;
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
} 