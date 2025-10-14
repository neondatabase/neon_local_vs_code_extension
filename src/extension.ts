import * as vscode from 'vscode';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';
import { ConnectViewProvider } from './connectView';
import { DatabaseViewProvider } from './databaseView';
import { ActionsViewProvider } from './actionsView';
import { SchemaViewProvider } from './schemaView';
import { MigrationsViewProvider } from './migrationsView';
import { ORMViewProvider } from './ormView';
import { DockerService } from './services/docker.service';
import { ViewData } from './types';
import { NeonApiService } from './services/api.service';
import { SchemaService } from './services/schema.service';
import { AuthManager } from './auth/authManager';

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  const stateService = new StateService(context);
  const apiService = new NeonApiService(context);
  const webviewService = new WebViewService(context, stateService);
  const dockerService = new DockerService(context, stateService);
  const authManager = AuthManager.getInstance(context);

  // Initialize webview service
  await webviewService.initialize();

  // Register the viewDataChanged command first
  context.subscriptions.push(
    vscode.commands.registerCommand('neonLocal.viewDataChanged', async (viewData: ViewData) => {
      webviewService.updateViewData('neonLocal', viewData);
      
      // Notify schema view of connection state changes
      try {
        await vscode.commands.executeCommand('neonLocal.schema.onConnectionStateChanged', viewData);
      } catch (error) {
        // Command may not be registered yet during initialization, silently ignore
        console.debug('Schema view connection state notification skipped (view not ready):', error);
      }
    })
  );

  // Check initial container status
  try {
    const isRunning = await dockerService.checkContainerStatus();
    if (isRunning) {
      console.debug('Container is already running, checking if it is ready...');
      
      // Check if the container is ready by looking at the logs
      const isReady = await dockerService.checkContainerReady();
      if (!isReady) {
        console.debug('Container is not ready (no ready message found), stopping it...');
        try {
          await dockerService.stopContainer();
          console.debug('Container stopped successfully');
        } catch (stopError) {
          console.error('Error stopping unready container:', stopError);
        }
        
        // Ensure the UI shows disconnected state
        await stateService.setIsProxyRunning(false);
        await stateService.setCurrentlyConnectedBranch('');
        await stateService.setDatabases([]);
        await stateService.setRoles([]);
        console.debug('State reset to disconnected after stopping unready container');
      } else {
        console.debug('Container is ready, updating state...');
        
        // First try to get branch ID from .branches file
        const branchId = await dockerService.checkBranchesFile(context);
        
        if (branchId) {
          console.debug('✅ Using branch ID from .branches file:', branchId);
          await stateService.setIsProxyRunning(true);
          await stateService.setCurrentlyConnectedBranch(branchId);

          // Fetch and update databases and roles
          try {
            const projectId = await stateService.getCurrentProjectId();
            console.debug('🔍 Extension startup - projectId:', projectId, 'branchId:', branchId);
            
            if (projectId) {
              console.debug('📊 Fetching databases and roles for startup...');
              const [databases, roles] = await Promise.all([
                apiService.getDatabases(projectId, branchId),
                apiService.getRoles(projectId, branchId)
              ]);
              await Promise.all([
                stateService.setDatabases(databases),
                stateService.setRoles(roles)
              ]);
              console.debug('✅ Updated databases and roles on startup');
            } else {
              console.warn('⚠️  No projectId found during startup');
            }
          } catch (error) {
            console.error('❌ Error fetching databases and roles on startup:', error);
          }
        } else {
          // Fallback to container info if .branches file doesn't have the ID
          console.debug('⚠️  No branch ID in .branches file, falling back to container info...');
          const containerInfo = await dockerService.getContainerInfo();
          if (containerInfo) {
            console.debug('✅ Using branch ID from container info:', containerInfo.branchId);
            await stateService.setIsProxyRunning(true);
            await stateService.setCurrentlyConnectedBranch(containerInfo.branchId);

            // Fetch and update databases and roles
            try {
              const projectId = containerInfo.projectId;
              console.debug('🔍 Extension startup (container fallback) - projectId:', projectId, 'branchId:', containerInfo.branchId);
              
              if (projectId) {
                console.debug('📊 Fetching databases and roles for startup (from container info)...');
                const [databases, roles] = await Promise.all([
                  apiService.getDatabases(projectId, containerInfo.branchId),
                  apiService.getRoles(projectId, containerInfo.branchId)
                ]);
                await Promise.all([
                  stateService.setDatabases(databases),
                  stateService.setRoles(roles)
                ]);
                console.debug('✅ Updated databases and roles on startup (from container info)');
              } else {
                console.warn('⚠️  No projectId found in container info during startup');
              }
            } catch (error) {
              console.error('❌ Error fetching databases and roles on startup (container fallback):', error);
            }
          } else {
            console.warn('⚠️  No container info available for fallback');
          }
        }
        
        // Start the status check to keep state in sync
        await dockerService.startStatusCheck();
        console.debug('Started status check for existing container');
      }
    } else {
      console.debug('No running container found on startup');
      await stateService.setIsProxyRunning(false);
    }
  } catch (error) {
    console.error('Error checking initial container status:', error);
    await stateService.setIsProxyRunning(false);
  }

  // Register commands
  let disposables: vscode.Disposable[] = [];

  // Register webview view providers
  const connectViewProvider = new ConnectViewProvider(
    context.extensionUri,
    webviewService,
    stateService,
    dockerService,
    context
  );
  const databaseViewProvider = new DatabaseViewProvider(
    context.extensionUri,
    webviewService,
    stateService,
    context
  );
  const actionsViewProvider = new ActionsViewProvider(
    context.extensionUri,
    webviewService,
    stateService
  );
  const schemaViewProvider = new SchemaViewProvider(
    context,
    stateService,
    authManager,
    dockerService
  );
  const migrationsViewProvider = new MigrationsViewProvider(
    context,
    stateService
  );
  const ormViewProvider = new ORMViewProvider(
    context,
    stateService,
    schemaViewProvider.getSchemaService()
  );


  // Store services for cleanup
  globalServices.schemaService = schemaViewProvider.getSchemaService();

  // Register core commands
  disposables.push(
    vscode.commands.registerCommand('neon-local-connect.configure', () => {
      webviewService.configure();
    }),
    vscode.commands.registerCommand('neon-local-connect.showPanel', () => {
      webviewService.showPanel(context);
    }),
    vscode.commands.registerCommand('neon-local-connect.stopProxy', async () => {
      await dockerService.stopContainer();
    }),
    vscode.commands.registerCommand('neon-local-connect.clearAuth', async () => {
      await authManager.signOut();
    }),
    vscode.commands.registerCommand('neon-local-connect.showWebviewStats', () => {
      const stats = webviewService.getRegistrationStats();
      vscode.window.showInformationMessage(
        `WebView Stats - Panels: ${stats.panels}, Views: ${stats.views}, Messages: ${stats.messageStats.successful} success / ${stats.messageStats.failed} failed`
      );
    }),
    vscode.commands.registerCommand('neon-local-connect.configureOAuthPort', async () => {
      try {
        // Get current configuration
        const config = vscode.workspace.getConfiguration('neonLocal');
        const currentPort = config.get<number | string>('oauthCallbackPort', 'auto');
        
        // Show quick pick for common options
        const quickPickItems = [
          {
            label: 'Auto (Recommended)',
            description: 'Let the system choose an available port automatically',
            detail: 'This is the safest option and avoids port conflicts',
            value: 'auto'
          },
          {
            label: 'Custom Port',
            description: 'Specify a specific port number',
            detail: 'Enter a port number between 1024 and 65535',
            value: 'custom'
          }
        ];

        const selection = await vscode.window.showQuickPick(quickPickItems, {
          placeHolder: `Current setting: ${currentPort}`,
          title: 'Configure OAuth Callback Port',
          ignoreFocusOut: true
        });

        if (!selection) {
          return; // User cancelled
        }

        let newPortValue: string | number;

        if (selection.value === 'auto') {
          newPortValue = 'auto';
        } else {
          // Custom port - show input box
          const portInput = await vscode.window.showInputBox({
            prompt: 'Enter a port number (1024-65535)',
            placeHolder: 'e.g., 8080',
            value: typeof currentPort === 'number' ? currentPort.toString() : '',
            validateInput: (value) => {
              if (!value || value.trim() === '') {
                return 'Port number is required';
              }
              
              const portNumber = parseInt(value.trim(), 10);
              if (isNaN(portNumber)) {
                return 'Port must be a valid number';
              }
              
              if (portNumber < 1024 || portNumber > 65535) {
                return 'Port must be between 1024 and 65535';
              }
              
              return undefined; // Valid
            },
            ignoreFocusOut: true
          });

          if (!portInput) {
            return; // User cancelled
          }

          newPortValue = parseInt(portInput.trim(), 10);
        }

        // Update the configuration
        await config.update('oauthCallbackPort', newPortValue, vscode.ConfigurationTarget.Global);

        // Show confirmation
        const portDisplay = newPortValue === 'auto' ? 'auto (dynamic)' : `${newPortValue} (static)`;
        vscode.window.showInformationMessage(
          `OAuth callback port set to: ${portDisplay}. This will take effect on the next authentication.`
        );

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to configure OAuth port: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  // Register database action commands
  disposables.push(
    vscode.commands.registerCommand('neon-local-connect.openSqlEditor', async () => {
      try {
        // Get the current project and branch IDs
        const projectId = await stateService.getCurrentProjectId();
        const viewData = await stateService.getViewData();
        const branchId = viewData.connectionType === 'new' ? viewData.currentlyConnectedBranch : await stateService.getCurrentBranchId();
        
        if (!projectId || !branchId) {
          throw new Error('Project ID or Branch ID not found');
        }

        // Get available databases
        const databases = await stateService.getDatabases();
        if (!databases || databases.length === 0) {
          throw new Error('No databases available');
        }

        // Prompt user to select a database
        const selectedDatabase = await vscode.window.showQuickPick(
          databases.map(db => ({
            label: db.name,
            description: `Owner: ${db.owner_name}`,
            detail: db.created_at ? `Created: ${new Date(db.created_at).toLocaleString()}` : undefined
          })),
          {
            placeHolder: 'Select a database',
            ignoreFocusOut: true
          }
        );

        if (!selectedDatabase) {
            return; // User cancelled
        }

        // Open the SQL Editor URL in the browser with the selected database
        const sqlEditorUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/sql-editor?database=${selectedDatabase.label}`;
        await vscode.env.openExternal(vscode.Uri.parse(sqlEditorUrl));
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open SQL Editor: ${error}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.openTableView', async () => {
      try {
        // Get the current project and branch IDs
        const projectId = await stateService.getCurrentProjectId();
        const viewData = await stateService.getViewData();
        const branchId = viewData.connectionType === 'new' ? viewData.currentlyConnectedBranch : await stateService.getCurrentBranchId();
        
        if (!projectId || !branchId) {
          throw new Error('Project ID or Branch ID not found');
        }

        // Get available databases
        const databases = await stateService.getDatabases();
        if (!databases || databases.length === 0) {
          throw new Error('No databases available');
        }

        // Prompt user to select a database
        const selectedDatabase = await vscode.window.showQuickPick(
          databases.map(db => ({
            label: db.name,
            description: `Owner: ${db.owner_name}`,
            detail: db.created_at ? `Created: ${new Date(db.created_at).toLocaleString()}` : undefined
          })),
          {
            placeHolder: 'Select a database to view tables',
            ignoreFocusOut: true
          }
        );

        if (!selectedDatabase) {
            return; // User cancelled
        }

        // Open the Table View URL in the browser with the selected database
        const tableViewUrl = `https://console.neon.tech/app/projects/${projectId}/branches/${branchId}/tables?database=${selectedDatabase.label}`;
        await vscode.env.openExternal(vscode.Uri.parse(tableViewUrl));
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open Table View: ${error}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.launchPsql', async () => {
      try {
        // Get the current project and branch IDs
        const projectId = await stateService.getCurrentProjectId();
        const viewData = await stateService.getViewData();
        const branchId = viewData.connectionType === 'new' ? viewData.currentlyConnectedBranch : await stateService.getCurrentBranchId();
        
        if (!projectId || !branchId) {
          throw new Error('Project ID or Branch ID not found');
        }

        // Get available databases and roles
        const databases = await stateService.getDatabases();
        const roles = await stateService.getRoles();
        if (!databases || databases.length === 0) {
          throw new Error('No databases available');
        }
        if (!roles || roles.length === 0) {
          throw new Error('No roles available');
        }

        // Prompt user to select a database
        const selectedDatabase = await vscode.window.showQuickPick(
          databases.map(db => ({
            label: db.name,
            description: `Owner: ${db.owner_name}`,
            detail: db.created_at ? `Created: ${new Date(db.created_at).toLocaleString()}` : undefined
          })),
          {
            placeHolder: 'Select a database to connect to',
            ignoreFocusOut: true
          }
        );

        if (!selectedDatabase) {
          return; // User cancelled
        }

        // Prompt user to select a role
        const selectedRole = await vscode.window.showQuickPick(
          roles.map(role => ({
            label: role.name,
            description: role.protected ? 'Protected' : undefined
          })),
          {
            placeHolder: 'Select a role to connect as',
            ignoreFocusOut: true
          }
        );

        if (!selectedRole) {
          return; // User cancelled
        }

        // Get the role password and compute endpoint
        const [password, endpoint] = await Promise.all([
          apiService.getRolePassword(projectId, branchId, selectedRole.label),
          apiService.getBranchEndpoint(projectId, branchId)
        ]);

        // Create the connection string
        const connectionString = `postgres://${selectedRole.label}:${password}@${endpoint}/${selectedDatabase.label}?sslmode=require`;

        // Launch PSQL with the connection string
        const terminal = vscode.window.createTerminal('Neon PSQL');
        terminal.show();
        terminal.sendText(`psql "${connectionString}"`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to launch PSQL: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.resetFromParent', async () => {
        try {
            const containerInfo = await dockerService.getContainerInfo();
            
            if (!containerInfo) {
                throw new Error('Container info not found. Make sure the container is running.');
            }
            
            const projectId = containerInfo.projectId;
            const branchId = await stateService.currentlyConnectedBranch;
            const viewData = await stateService.getViewData();
            const connectionType = viewData.connectionType;
            const branchName = connectionType === 'existing' ? viewData.selectedBranchName : branchId;
            
            console.debug('Reset from parent - Project ID:', projectId);
            console.debug('Reset from parent - Branch ID:', branchId);
            console.debug('Reset from parent - Branch Name:', branchName);
            console.debug('Reset from parent - Connection Type:', connectionType);
            
            if (!projectId || !branchId) {
                throw new Error('Project ID or Branch ID not found');
            }

            // Check if the branch has a parent
            const branchDetails = await apiService.getBranchDetails(projectId, branchId);
            if (!branchDetails.parent_id) {
                vscode.window.showErrorMessage(`Cannot reset branch "${branchName}" as it does not have a parent branch.`);
                return;
            }

            // Add confirmation dialog with appropriate branch identifier
            const confirmMessage = connectionType === 'existing' 
                ? `Are you sure you want to reset branch "${branchName}" to its parent state? This action cannot be undone.`
                : `Are you sure you want to reset branch "${branchId}" to its parent state? This action cannot be undone.`;

            const answer = await vscode.window.showInformationMessage(
                confirmMessage,
                { modal: true },
                'Reset'
            );

            if (answer !== 'Reset') {
                return;
            }

            // Reset the branch using the API service
            await apiService.resetBranchToParent(projectId, branchId);

            // Show success message with appropriate branch identifier
            const successMessage = connectionType === 'existing'
                ? `Branch "${branchName}" reset.`
                : `Branch "${branchId}" reset.`;

            vscode.window.showInformationMessage(successMessage);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reset branch: ${error}`);
        }
    })
  );

  // Register view providers
  disposables.push(
    vscode.window.registerWebviewViewProvider('neonLocalConnect', connectViewProvider),
    vscode.window.registerWebviewViewProvider('neonLocalDatabase', databaseViewProvider),
    vscode.window.registerWebviewViewProvider('neonLocalActions', actionsViewProvider)
  );

  // Update context for schema view visibility
  const updateSchemaViewContext = async () => {
    const viewData = await stateService.getViewData();
    vscode.commands.executeCommand('setContext', 'neonLocal.connected', viewData.connected);
  };

  // Initial context update
  updateSchemaViewContext();

  // Listen for connection state changes to update context
  const originalSetIsProxyRunning = stateService.setIsProxyRunning.bind(stateService);
  stateService.setIsProxyRunning = async (value: boolean) => {
    await originalSetIsProxyRunning(value);
    vscode.commands.executeCommand('setContext', 'neonLocal.connected', value);
  };

  context.subscriptions.push(...disposables);
}

// Store services globally for cleanup
let globalServices: {
  schemaService?: SchemaService;
} = {};

export async function deactivate() {
  console.debug('Extension deactivating, cleaning up resources...');
  
  try {
    // Cleanup schema service connection pools
    if (globalServices.schemaService) {
      await globalServices.schemaService.cleanup();
      console.debug('Schema service cleanup completed');
    }
    
    
    console.debug('Extension deactivation cleanup completed');
  } catch (error) {
    console.error('Error during extension deactivation:', error);
  }
} 