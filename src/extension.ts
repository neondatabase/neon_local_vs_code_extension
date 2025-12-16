import * as vscode from 'vscode';
import { WebViewService } from './services/webview.service';
import { StateService } from './services/state.service';
import { ConnectViewProvider } from './views/connectView';
import { SchemaViewProvider } from './views/schemaView';
import { MCPServerViewProvider } from './views/mcpServerView';
// import { MigrationsViewProvider } from './views/migrationsView';
// import { ORMViewProvider } from './views/ormView';
import { ViewData } from './types';
import { NeonApiService } from './services/api.service';
import { SchemaService } from './services/schema.service';
import { AuthManager } from './auth/authManager';

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  const stateService = new StateService(context);
  const apiService = new NeonApiService(context);
  const webviewService = new WebViewService(context, stateService);
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

  // Register commands
  let disposables: vscode.Disposable[] = [];

  // Register webview view providers
  const connectViewProvider = new ConnectViewProvider(
    context.extensionUri,
    webviewService,
    stateService,
    context
  );
  const schemaViewProvider = new SchemaViewProvider(
    context,
    stateService,
    authManager
  );
  // Migrations and ORM views temporarily disabled for this release
  // const migrationsViewProvider = new MigrationsViewProvider(
  //   context,
  //   stateService
  // );
  // const ormViewProvider = new ORMViewProvider(
  //   context,
  //   stateService,
  //   schemaViewProvider.getSchemaService()
  // );


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
    vscode.commands.registerCommand('neonLocal.importApiToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your Neon API token',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'Paste your API token here'
      });

      if (token) {
        try {
          // Validate the token
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Validating API token...",
            cancellable: false
          }, async () => {
            const isValid = await apiService.validateToken(token);
            
            if (!isValid) {
              throw new Error('Invalid API token');
            }
            
            // Token is valid, store it
            await authManager.setPersistentApiToken(token);
            await stateService.setPersistentApiToken(token);
          });
          
          vscode.window.showInformationMessage('API token imported successfully!');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          vscode.window.showErrorMessage(`Failed to import API token: ${errorMessage}`);
        }
      }
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
        // Get the current view data
        const viewData = await stateService.getViewData();
        
        if (!viewData.connected) {
          throw new Error('Database is not connected. Please connect first.');
        }

        const connectionInfos = viewData.connection.branchConnectionInfos;
        
        if (!connectionInfos || connectionInfos.length === 0) {
          throw new Error('No connection information available. Please reconnect.');
        }

        // Get unique databases
        const databases = Array.from(new Set(connectionInfos.map(info => info.database)));

        // Prompt user to select a database
        const selectedDatabase = await vscode.window.showQuickPick(
          databases.map(db => ({
            label: db,
            description: undefined
          })),
          {
            placeHolder: 'Select a database to connect to',
            title: 'Select Database for PSQL'
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

        // Prompt user to select a role
        const selectedRole = await vscode.window.showQuickPick(
          uniqueRoles.map(role => ({
            label: role,
            description: undefined
          })),
          {
            placeHolder: 'Select a role to connect as',
            title: 'Select Role for PSQL'
          }
        );

        if (!selectedRole) {
          return; // User cancelled
        }

        // Find the connection info for the selected database and role
        const connectionInfo = connectionInfos.find(
          info => info.database === selectedDatabase.label && info.user === selectedRole.label
        );

        if (!connectionInfo) {
          throw new Error(`No connection info found for database ${selectedDatabase.label} and role ${selectedRole.label}`);
        }

        // Build the direct Neon connection string
        const connectionString = `postgresql://${connectionInfo.user}:${connectionInfo.password}@${connectionInfo.host}/${connectionInfo.database}?sslmode=require`;

        // Launch PSQL with the direct Neon connection string
        const terminal = vscode.window.createTerminal(`Neon PSQL - ${selectedDatabase.label} (${selectedRole.label})`);
        terminal.show();
        terminal.sendText(`psql "${connectionString}"`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to launch PSQL: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.resetFromParent', async () => {
        try {
            // Get project and branch IDs from state
            const projectId = await stateService.getCurrentProjectId();
            const branchId = await stateService.currentlyConnectedBranch;
            const viewData = await stateService.getViewData();
            const branchName = viewData.connection.selectedBranchName || branchId;
            
            console.debug('Reset from parent - Project ID:', projectId);
            console.debug('Reset from parent - Branch ID:', branchId);
            console.debug('Reset from parent - Branch Name:', branchName);
            
            if (!projectId || !branchId) {
                throw new Error('Project ID or Branch ID not found. Please ensure you are connected to a branch.');
            }

            // Check if the branch has a parent
            const branchDetails = await apiService.getBranchDetails(projectId, branchId);
            if (!branchDetails.parent_id) {
                vscode.window.showErrorMessage(`Cannot reset branch "${branchName}" as it does not have a parent branch.`);
                return;
            }

            // Add confirmation dialog
            const confirmMessage = `Are you sure you want to reset branch "${branchName}" to its parent state? This action cannot be undone.`;

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

            // Show success message
            vscode.window.showInformationMessage(`Branch "${branchName}" reset.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reset branch: ${error}`);
        }
    })
  );

  // Register view providers
  const mcpServerViewProvider = new MCPServerViewProvider(
    context.extensionUri,
    context
  );
  
  disposables.push(
    vscode.window.registerWebviewViewProvider('neonLocalConnect', connectViewProvider),
    vscode.window.registerWebviewViewProvider('neonLocalMcpServer', mcpServerViewProvider)
  );
  
  // Register MCP Server commands
  disposables.push(
    vscode.commands.registerCommand('neonLocal.mcpServer.refresh', async () => {
      await mcpServerViewProvider.refreshView();
    }),
    vscode.commands.registerCommand('neonLocal.mcpServer.enable', async () => {
      await mcpServerViewProvider.enableMcpServer();
    }),
    vscode.commands.registerCommand('neonLocal.mcpServer.disable', async () => {
      await mcpServerViewProvider.disableMcpServer();
    })
  );

  // Register Connect View commands
  disposables.push(
    vscode.commands.registerCommand('neonLocal.connect.refresh', async () => {
      await connectViewProvider.refresh();
    })
  );
  
  // Auto-configure MCP server if enabled
  mcpServerViewProvider.autoConfigureIfNeeded();

  // Update context for view visibility
  const updateViewContexts = async () => {
    const viewData = await stateService.getViewData();
    const isAuthenticated = authManager.isAuthenticated;
    
    // Set authenticated context for MCP Server view
    vscode.commands.executeCommand('setContext', 'neonLocal.authenticated', isAuthenticated);
    
    // Set connected context for schema view (requires both authentication and connection)
    const shouldShowSchemaView = isAuthenticated && viewData.connected;
    vscode.commands.executeCommand('setContext', 'neonLocal.connected', shouldShowSchemaView);
  };

  // Initial context update
  updateViewContexts();

  // Listen for authentication state changes to update context
  const authListener = authManager.onDidChangeAuthentication(async () => {
    await updateViewContexts();
  });

  // Listen for connection state changes to update context
  const originalSetIsProxyRunning = stateService.setIsProxyRunning.bind(stateService);
  stateService.setIsProxyRunning = async (value: boolean) => {
    await originalSetIsProxyRunning(value);
    await updateViewContexts();
  };

  context.subscriptions.push(...disposables, authListener);
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