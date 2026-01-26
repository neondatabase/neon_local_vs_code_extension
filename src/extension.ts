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
import { SqlQueryPanel } from './panels/sqlQueryPanel';
import { TableDataPanel } from './panels/tableDataPanel';

/**
 * URI Handler for the Neon extension
 * Supports the following URIs:
 * - vscode://databricks.neon-local-connect/import-api-key?token=xxx
 * - vscode://databricks.neon-local-connect/sign-in
 */
class NeonUriHandler implements vscode.UriHandler {
  constructor(
    private readonly authManager: AuthManager,
    private readonly apiService: NeonApiService,
    private readonly stateService: StateService
  ) {}

  async handleUri(uri: vscode.Uri): Promise<void> {
    console.debug('NeonUriHandler: Received URI:', uri.toString());
    
    const path = uri.path;
    const query = new URLSearchParams(uri.query);

    switch (path) {
      case '/import-api-key':
        await this.handleImportApiKey(query);
        break;
      case '/sign-in':
        await this.handleSignIn();
        break;
      default:
        vscode.window.showWarningMessage(`Unknown Neon URI path: ${path}`);
    }
  }

  private async handleImportApiKey(query: URLSearchParams): Promise<void> {
    let token = query.get('token');

    // If no token in URL, prompt for it
    if (!token) {
      token = await vscode.window.showInputBox({
        prompt: 'Enter your Neon API token',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'Paste your API token here'
      });
    }

    if (!token) {
      return; // User cancelled
    }

    try {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Validating API token...",
        cancellable: false
      }, async () => {
        const isValid = await this.apiService.validateToken(token!);
        
        if (!isValid) {
          throw new Error('Invalid API token');
        }
        
        // Token is valid, store it via authManager (matching sign-in flow)
        await this.authManager.setPersistentApiToken(token!);
        
        // Fetch back from authManager and update stateService (matching sign-in flow)
        const persistentToken = await this.authManager.getPersistentApiToken();
        if (persistentToken) {
          await this.stateService.setPersistentApiToken(persistentToken);
        }
      });
      
      vscode.window.showInformationMessage('API token imported successfully!');
      
      // Focus the connect view
      await vscode.commands.executeCommand('neonLocalConnect.focus');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`Failed to import API token: ${errorMessage}`);
    }
  }

  private async handleSignIn(): Promise<void> {
    try {
      await this.authManager.signIn();
      
      // After sign-in, update stateService with the persistent token (matching sidebar flow)
      const persistentToken = await this.authManager.getPersistentApiToken();
      if (persistentToken) {
        await this.stateService.setPersistentApiToken(persistentToken);
      }
      
      // Focus the connect view
      await vscode.commands.executeCommand('neonLocalConnect.focus');
    } catch (error) {
      // Error is already shown by authManager.signIn()
      console.error('Sign in via URI failed:', error);
    }
  }
}

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  const stateService = new StateService(context);
  const apiService = new NeonApiService(context);
  const webviewService = new WebViewService(context, stateService);
  const authManager = AuthManager.getInstance(context);

  // Initialize webview service
  await webviewService.initialize();

  // Register URI handler for external links
  // Supports: vscode://databricks.neon-local-connect/import-api-key?token=xxx
  //           vscode://databricks.neon-local-connect/sign-in
  const uriHandler = new NeonUriHandler(authManager, apiService, stateService);
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

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
    vscode.commands.registerCommand('neon-local-connect.configure', async () => {
      // Redirect to the proper import API token command
      await vscode.commands.executeCommand('neonLocal.importApiToken');
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
            
            // Token is valid, store it via authManager (matching sign-in flow)
            await authManager.setPersistentApiToken(token);
            
            // Fetch back from authManager and update stateService (matching sign-in flow)
            const persistentToken = await authManager.getPersistentApiToken();
            if (persistentToken) {
              await stateService.setPersistentApiToken(persistentToken);
            }
          });
          
          vscode.window.showInformationMessage('API token imported successfully!');
          
          // Focus the connect view
          await vscode.commands.executeCommand('neonLocalConnect.focus');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          vscode.window.showErrorMessage(`Failed to import API token: ${errorMessage}`);
        }
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.signIn', async () => {
      try {
        await authManager.signIn();
        
        // After sign-in, update stateService with the persistent token (matching sidebar flow)
        const persistentToken = await authManager.getPersistentApiToken();
        if (persistentToken) {
          await stateService.setPersistentApiToken(persistentToken);
        }
        
        // Focus the connect view
        await vscode.commands.executeCommand('neonLocalConnect.focus');
      } catch (error) {
        // Error is already shown by authManager.signIn()
        console.error('Sign in failed:', error);
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
    vscode.commands.registerCommand('neon-local-connect.stopProxy', async () => {
      try {
        // Clear connection state (same as the Disconnect button in the webview)
        await stateService.setBranchConnectionInfos([]);
        await stateService.setIsProxyRunning(false);
        await stateService.setCurrentlyConnectedBranch('');
        vscode.window.showInformationMessage('Disconnected from Neon database');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.connect', async () => {
      try {
        // Check if authenticated
        if (!authManager.isAuthenticated) {
          // Focus on the Branch Connection view to show sign-in
          await vscode.commands.executeCommand('neonLocalConnect.focus');
          return;
        }

        // Get organizations
        const orgs = await apiService.getOrgs();
        if (!orgs || orgs.length === 0) {
          throw new Error('No organizations found.');
        }

        // Select organization (skip prompt if only one)
        let selectedOrg: { id: string; name: string };
        if (orgs.length === 1) {
          selectedOrg = { id: orgs[0].id, name: orgs[0].name };
        } else {
          const orgPick = await vscode.window.showQuickPick(
            orgs.map(org => ({ label: org.name, id: org.id })),
            { placeHolder: 'Select an organization', title: 'Connect - Select Organization' }
          );
          if (!orgPick) {
            return; // User cancelled
          }
          selectedOrg = { id: orgPick.id, name: orgPick.label };
        }

        // Get projects for selected organization
        const projects = await apiService.getProjects(selectedOrg.id);
        if (!projects || projects.length === 0) {
          throw new Error('No projects found in the selected organization.');
        }

        // Select project (skip prompt if only one)
        let selectedProject: { id: string; name: string };
        if (projects.length === 1) {
          selectedProject = { id: projects[0].id, name: projects[0].name };
        } else {
          const projectPick = await vscode.window.showQuickPick(
            projects.map(project => ({ label: project.name, id: project.id })),
            { placeHolder: 'Select a project', title: 'Connect - Select Project' }
          );
          if (!projectPick) {
            return; // User cancelled
          }
          selectedProject = { id: projectPick.id, name: projectPick.label };
        }

        // Get branches for selected project
        const branches = await apiService.getBranches(selectedProject.id);
        if (!branches || branches.length === 0) {
          throw new Error('No branches found in the selected project.');
        }

        // Select branch (skip prompt if only one)
        let selectedBranch: { id: string; name: string; parent_id: string | null };
        if (branches.length === 1) {
          selectedBranch = { id: branches[0].id, name: branches[0].name, parent_id: branches[0].parent_id };
        } else {
          const branchPick = await vscode.window.showQuickPick(
            branches.map(branch => ({
              label: branch.name,
              id: branch.id,
              parent_id: branch.parent_id,
              description: branch.name === 'main' ? '(Default)' : undefined
            })),
            { placeHolder: 'Select a branch to connect to', title: 'Connect - Select Branch' }
          );
          if (!branchPick) {
            return; // User cancelled
          }
          selectedBranch = { id: branchPick.id, name: branchPick.label, parent_id: branchPick.parent_id };
        }

        // Connect to the branch
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to branch "${selectedBranch.name}"...`,
          cancellable: false
        }, async () => {
          // Fetch connection info, databases, and roles
          const [connectionInfos, databases, roles] = await Promise.all([
            apiService.getBranchConnectionInfo(selectedProject.id, selectedBranch.id),
            apiService.getDatabases(selectedProject.id, selectedBranch.id),
            apiService.getRoles(selectedProject.id, selectedBranch.id)
          ]);

          // Get current state
          const currentState = await stateService.getViewData();

          // Build connection string for display
          const firstConnection = connectionInfos[0];
          const connectionString = firstConnection 
            ? `postgresql://${firstConnection.user}:${firstConnection.password}@${firstConnection.host}/${firstConnection.database}?sslmode=require`
            : '';

          // Find parent branch info if exists
          const parentBranch = selectedBranch.parent_id 
            ? branches.find(b => b.id === selectedBranch.parent_id) 
            : null;

          // Update state with connection info
          await stateService.updateState({
            selection: {
              orgs: currentState.orgs.length > 0 ? currentState.orgs : [{ id: selectedOrg.id, name: selectedOrg.name }],
              projects: currentState.projects.length > 0 ? currentState.projects : projects,
              branches: branches,
              selectedOrgId: selectedOrg.id,
              selectedOrgName: selectedOrg.name,
              selectedProjectId: selectedProject.id,
              selectedProjectName: selectedProject.name,
              selectedBranchId: selectedBranch.id,
              selectedBranchName: selectedBranch.name,
              parentBranchId: parentBranch?.id || '',
              parentBranchName: parentBranch?.name || ''
            },
            connection: {
              ...currentState.connection,
              connected: true,
              connectionInfo: connectionString,
              databases,
              roles,
              connectedOrgId: selectedOrg.id,
              connectedOrgName: selectedOrg.name,
              connectedProjectId: selectedProject.id,
              connectedProjectName: selectedProject.name,
              currentlyConnectedBranch: selectedBranch.id,
              branchConnectionInfos: connectionInfos,
              selectedDatabase: databases.length > 0 ? databases[0].name : ''
            }
          });

          // Set connected state
          await stateService.setCurrentlyConnectedBranch(selectedBranch.id);
          await stateService.setCurrentBranch(selectedBranch.id);
          await stateService.setBranchConnectionInfos(connectionInfos);
          await stateService.setDatabases(databases);
          await stateService.setRoles(roles);
          await stateService.setIsProxyRunning(true);

          vscode.window.showInformationMessage(`Connected to branch "${selectedBranch.name}".`);
        });

        // Focus on the Databases view to show the connected schema
        await vscode.commands.executeCommand('neonLocalSchema.focus');

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.configureMcpServer', async () => {
      // Focus on the MCP Server view
      await vscode.commands.executeCommand('neonLocalMcpServer.focus');
    }),
    vscode.commands.registerCommand('neon-local-connect.viewDatabases', async () => {
      // Focus on the Databases view
      await vscode.commands.executeCommand('neonLocalSchema.focus');
    }),
    vscode.commands.registerCommand('neon-local-connect.getStarted', async () => {
      // Trigger the "Get started with Neon" flow
      await connectViewProvider.getStartedWithNeon();
    }),
    vscode.commands.registerCommand('neon-local-connect.createBranch', async () => {
      try {
        // Check if authenticated
        if (!authManager.isAuthenticated) {
          throw new Error('Not authenticated. Please sign in first.');
        }

        // Get organizations
        const orgs = await apiService.getOrgs();
        if (!orgs || orgs.length === 0) {
          throw new Error('No organizations found.');
        }

        // Select organization (skip prompt if only one)
        let selectedOrg: { id: string; name: string };
        if (orgs.length === 1) {
          selectedOrg = { id: orgs[0].id, name: orgs[0].name };
        } else {
          const orgPick = await vscode.window.showQuickPick(
            orgs.map(org => ({ label: org.name, id: org.id })),
            { placeHolder: 'Select an organization', title: 'Create Branch - Select Organization' }
          );
          if (!orgPick) {
            return; // User cancelled
          }
          selectedOrg = { id: orgPick.id, name: orgPick.label };
        }

        // Get projects for selected organization
        const projects = await apiService.getProjects(selectedOrg.id);
        if (!projects || projects.length === 0) {
          throw new Error('No projects found in the selected organization.');
        }

        // Select project (skip prompt if only one)
        let selectedProject: { id: string; name: string };
        if (projects.length === 1) {
          selectedProject = { id: projects[0].id, name: projects[0].name };
        } else {
          const projectPick = await vscode.window.showQuickPick(
            projects.map(project => ({ label: project.name, id: project.id })),
            { placeHolder: 'Select a project', title: 'Create Branch - Select Project' }
          );
          if (!projectPick) {
            return; // User cancelled
          }
          selectedProject = { id: projectPick.id, name: projectPick.label };
        }

        // Get branches for selected project
        const branches = await apiService.getBranches(selectedProject.id);
        if (!branches || branches.length === 0) {
          throw new Error('No branches found in the selected project.');
        }

        // Select parent branch (skip prompt if only one)
        let selectedParentBranch: { id: string; name: string };
        if (branches.length === 1) {
          selectedParentBranch = { id: branches[0].id, name: branches[0].name };
        } else {
          const branchPick = await vscode.window.showQuickPick(
            branches.map(branch => ({
              label: branch.name,
              id: branch.id,
              description: branch.name === 'main' ? '(Default)' : undefined
            })),
            { placeHolder: 'Select a parent branch', title: 'Create Branch - Select Parent Branch' }
          );
          if (!branchPick) {
            return; // User cancelled
          }
          selectedParentBranch = { id: branchPick.id, name: branchPick.label };
        }

        // Ask for new branch name
        const branchName = await vscode.window.showInputBox({
          prompt: 'Enter a name for the new branch',
          placeHolder: 'e.g., feature/my-new-branch',
          title: 'Create Branch - Enter Branch Name',
          validateInput: (text) => {
            if (!text || text.trim().length === 0) {
              return 'Branch name is required';
            }
            // Basic validation for branch name format
            if (!/^[a-zA-Z0-9._/-]+$/.test(text)) {
              return 'Branch name can only contain letters, numbers, dots, underscores, slashes, and hyphens';
            }
            return null;
          }
        });

        if (!branchName) {
          return; // User cancelled
        }

        // Create the branch with progress indicator
        let newBranch: any;
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Creating branch "${branchName}"...`,
          cancellable: false
        }, async () => {
          newBranch = await apiService.createBranch(
            selectedProject.id,
            selectedParentBranch.id,
            branchName
          );
        });

        // Ask if user wants to connect to the new branch
        const connectChoice = await vscode.window.showInformationMessage(
          `Branch "${newBranch.name}" created successfully. Would you like to connect to it?`,
          'Yes',
          'No'
        );

        if (connectChoice === 'Yes') {
          // Connect to the new branch
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to branch "${newBranch.name}"...`,
            cancellable: false
          }, async () => {
            // Fetch connection info, databases, and roles
            const [connectionInfos, databases, roles] = await Promise.all([
              apiService.getBranchConnectionInfo(selectedProject.id, newBranch.id),
              apiService.getDatabases(selectedProject.id, newBranch.id),
              apiService.getRoles(selectedProject.id, newBranch.id)
            ]);

            // Get current state
            const currentState = await stateService.getViewData();

            // Build connection string for display
            const firstConnection = connectionInfos[0];
            const connectionString = firstConnection 
              ? `postgresql://${firstConnection.user}:${firstConnection.password}@${firstConnection.host}/${firstConnection.database}?sslmode=require`
              : '';

            // Fetch all branches for the project to include the new one
            const allBranches = await apiService.getBranches(selectedProject.id);

            // Update state with connection info
            await stateService.updateState({
              selection: {
                orgs: currentState.orgs.length > 0 ? currentState.orgs : [{ id: selectedOrg.id, name: selectedOrg.name }],
                projects: currentState.projects.length > 0 ? currentState.projects : projects,
                branches: allBranches,
                selectedOrgId: selectedOrg.id,
                selectedOrgName: selectedOrg.name,
                selectedProjectId: selectedProject.id,
                selectedProjectName: selectedProject.name,
                selectedBranchId: newBranch.id,
                selectedBranchName: newBranch.name,
                parentBranchId: selectedParentBranch.id,
                parentBranchName: selectedParentBranch.name
              },
              connection: {
                ...currentState.connection,
                connected: true,
                connectionInfo: connectionString,
                databases,
                roles,
                connectedOrgId: selectedOrg.id,
                connectedOrgName: selectedOrg.name,
                connectedProjectId: selectedProject.id,
                connectedProjectName: selectedProject.name,
                currentlyConnectedBranch: newBranch.id,
                branchConnectionInfos: connectionInfos,
                selectedDatabase: databases.length > 0 ? databases[0].name : ''
              }
            });

            // Set connected state
            await stateService.setCurrentlyConnectedBranch(newBranch.id);
            await stateService.setCurrentBranch(newBranch.id);
            await stateService.setBranchConnectionInfos(connectionInfos);
            await stateService.setDatabases(databases);
            await stateService.setRoles(roles);
            await stateService.setIsProxyRunning(true);

            vscode.window.showInformationMessage(`Connected to branch "${newBranch.name}".`);
          });

          // Focus on the Databases view to show the connected schema
          await vscode.commands.executeCommand('neonLocalSchema.focus');
        }

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create branch: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.queryTable', async () => {
      try {
        const schemaService = globalServices.schemaService;
        if (!schemaService) {
          throw new Error('Schema service not available. Please ensure you are connected to a database.');
        }

        // Check if connected
        const viewData = await stateService.getViewData();
        if (!viewData.connected) {
          throw new Error('Not connected to a database. Please connect first.');
        }

        // Get databases
        const allDatabases = await schemaService.getDatabases();
        if (!allDatabases || allDatabases.length === 0) {
          throw new Error('No databases available.');
        }

        // Build a map of databases -> schemas -> tables/views
        const databaseSchemaMap: Map<string, Map<string, { name: string; type: string }[]>> = new Map();
        
        for (const db of allDatabases) {
          const schemas = await schemaService.getSchemas(db.name);
          const schemaMap: Map<string, { name: string; type: string }[]> = new Map();
          
          for (const schema of schemas) {
            const tables = await schemaService.getTables(db.name, schema.name);
            const views = await schemaService.getViews(db.name, schema.name);
            const allItems = [
              ...tables.map(t => ({ name: t.name, type: 'table' })),
              ...views.map(v => ({ name: v.name, type: v.metadata?.is_materialized ? 'materialized view' : 'view' }))
            ];
            
            if (allItems.length > 0) {
              schemaMap.set(schema.name, allItems);
            }
          }
          
          if (schemaMap.size > 0) {
            databaseSchemaMap.set(db.name, schemaMap);
          }
        }

        // Filter to only databases with tables/views
        const databases = Array.from(databaseSchemaMap.keys());
        if (databases.length === 0) {
          throw new Error('No tables or views found in any database.');
        }

        // Select database (skip prompt if only one)
        let selectedDatabase: string;
        if (databases.length === 1) {
          selectedDatabase = databases[0];
        } else {
          const dbPick = await vscode.window.showQuickPick(
            databases.map(db => ({ label: db })),
            { placeHolder: 'Select a database', title: 'Query Table - Select Database' }
          );
          if (!dbPick) {
            return; // User cancelled
          }
          selectedDatabase = dbPick.label;
        }

        // Get schemas with tables/views for selected database
        const schemaMap = databaseSchemaMap.get(selectedDatabase)!;
        const schemas = Array.from(schemaMap.keys());

        // Select schema (skip prompt if only one)
        let selectedSchema: string;
        if (schemas.length === 1) {
          selectedSchema = schemas[0];
        } else {
          const schemaPick = await vscode.window.showQuickPick(
            schemas.map(s => ({ label: s })),
            { placeHolder: 'Select a schema', title: 'Query Table - Select Schema' }
          );
          if (!schemaPick) {
            return; // User cancelled
          }
          selectedSchema = schemaPick.label;
        }

        // Get tables/views for selected schema
        const tablesAndViews = schemaMap.get(selectedSchema)!;

        // Select table/view (skip prompt if only one)
        let selectedTable: string;
        if (tablesAndViews.length === 1) {
          selectedTable = tablesAndViews[0].name;
        } else {
          const tablePick = await vscode.window.showQuickPick(
            tablesAndViews.map(t => ({ label: t.name, description: t.type })),
            { placeHolder: 'Select a table or view', title: 'Query Table - Select Table/View' }
          );
          if (!tablePick) {
            return; // User cancelled
          }
          selectedTable = tablePick.label;
        }

        // Generate and execute query
        const query = `SELECT *\nFROM ${selectedSchema}.${selectedTable}\nLIMIT 100;`;
        SqlQueryPanel.createOrShow(context, stateService, query, selectedDatabase);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to query table: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
    vscode.commands.registerCommand('neon-local-connect.viewTableData', async () => {
      try {
        const schemaService = globalServices.schemaService;
        if (!schemaService) {
          throw new Error('Schema service not available. Please ensure you are connected to a database.');
        }

        // Check if connected
        const viewData = await stateService.getViewData();
        if (!viewData.connected) {
          throw new Error('Not connected to a database. Please connect first.');
        }

        // Get databases
        const allDatabases = await schemaService.getDatabases();
        if (!allDatabases || allDatabases.length === 0) {
          throw new Error('No databases available.');
        }

        // Build a map of databases -> schemas -> tables/views
        const databaseSchemaMap: Map<string, Map<string, { name: string; type: string }[]>> = new Map();
        
        for (const db of allDatabases) {
          const schemas = await schemaService.getSchemas(db.name);
          const schemaMap: Map<string, { name: string; type: string }[]> = new Map();
          
          for (const schema of schemas) {
            const tables = await schemaService.getTables(db.name, schema.name);
            const views = await schemaService.getViews(db.name, schema.name);
            const allItems = [
              ...tables.map(t => ({ name: t.name, type: 'table' })),
              ...views.map(v => ({ name: v.name, type: v.metadata?.is_materialized ? 'materialized view' : 'view' }))
            ];
            
            if (allItems.length > 0) {
              schemaMap.set(schema.name, allItems);
            }
          }
          
          if (schemaMap.size > 0) {
            databaseSchemaMap.set(db.name, schemaMap);
          }
        }

        // Filter to only databases with tables/views
        const databases = Array.from(databaseSchemaMap.keys());
        if (databases.length === 0) {
          throw new Error('No tables or views found in any database.');
        }

        // Select database (skip prompt if only one)
        let selectedDatabase: string;
        if (databases.length === 1) {
          selectedDatabase = databases[0];
        } else {
          const dbPick = await vscode.window.showQuickPick(
            databases.map(db => ({ label: db })),
            { placeHolder: 'Select a database', title: 'View Table Data - Select Database' }
          );
          if (!dbPick) {
            return; // User cancelled
          }
          selectedDatabase = dbPick.label;
        }

        // Get schemas with tables/views for selected database
        const schemaMap = databaseSchemaMap.get(selectedDatabase)!;
        const schemas = Array.from(schemaMap.keys());

        // Select schema (skip prompt if only one)
        let selectedSchema: string;
        if (schemas.length === 1) {
          selectedSchema = schemas[0];
        } else {
          const schemaPick = await vscode.window.showQuickPick(
            schemas.map(s => ({ label: s })),
            { placeHolder: 'Select a schema', title: 'View Table Data - Select Schema' }
          );
          if (!schemaPick) {
            return; // User cancelled
          }
          selectedSchema = schemaPick.label;
        }

        // Get tables/views for selected schema
        const tablesAndViews = schemaMap.get(selectedSchema)!;

        // Select table/view (skip prompt if only one)
        let selectedTable: string;
        if (tablesAndViews.length === 1) {
          selectedTable = tablesAndViews[0].name;
        } else {
          const tablePick = await vscode.window.showQuickPick(
            tablesAndViews.map(t => ({ label: t.name, description: t.type })),
            { placeHolder: 'Select a table or view', title: 'View Table Data - Select Table/View' }
          );
          if (!tablePick) {
            return; // User cancelled
          }
          selectedTable = tablePick.label;
        }

        // Open table data panel
        TableDataPanel.createOrShow(context, stateService, selectedSchema, selectedTable, selectedDatabase);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to view table data: ${error instanceof Error ? error.message : String(error)}`);
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

  // Initial context update - wait for both state service and auth manager to be ready
  Promise.all([stateService.ready(), authManager.ready()]).then(async () => {
    console.debug('State service and auth manager ready, updating view contexts...');
    
    // Check if we need to restore a connection from a previous session
    // This needs to happen BEFORE updateViewContexts so the schema view doesn't
    // try to load data before connection info is available
    if (stateService.needsConnectionRestore() && authManager.isAuthenticated) {
      console.debug('Connection needs to be restored from previous session, fetching connection info...');
      const restoreInfo = stateService.getPendingRestoreInfo();
      
      if (restoreInfo) {
        try {
          // Fetch connection info, databases, and roles in parallel
          const [connectionInfos, databases, roles] = await Promise.all([
            apiService.getBranchConnectionInfo(restoreInfo.projectId, restoreInfo.branchId),
            apiService.getDatabases(restoreInfo.projectId, restoreInfo.branchId),
            apiService.getRoles(restoreInfo.projectId, restoreInfo.branchId)
          ]);
          
          // Store the fetched data
          await stateService.setBranchConnectionInfos(connectionInfos);
          await stateService.setDatabases(databases);
          await stateService.setRoles(roles);
          
          console.debug('Connection info fetched, marking connection as restored:', {
            connectionInfos: connectionInfos.length,
            databases: databases.length,
            roles: roles.length
          });
          
          // NOW mark as connected - this will trigger view updates
          await stateService.markConnectionRestored();
        } catch (error) {
          console.error('Failed to restore connection info on startup:', error);
          // Mark restore as failed so we don't keep trying
          stateService.markConnectionRestoreFailed();
        }
      } else {
        console.debug('No restore info available, skipping connection restore');
        stateService.markConnectionRestoreFailed();
      }
    }
    
    await updateViewContexts();
  });

  // Listen for authentication state changes to update context
  const authListener = authManager.onDidChangeAuthentication(async (isAuthenticated) => {
    await updateViewContexts();
    
    // When user signs in, attempt to auto-configure MCP server if not already configured
    // and sync the token if already configured with a managed config
    if (isAuthenticated) {
      console.debug('User signed in, checking MCP server auto-configuration and token sync...');
      // Small delay to ensure persistent API token is stored
      setTimeout(async () => {
        await mcpServerViewProvider.autoConfigureIfNeeded();
        // Sync the MCP token in case the user re-authenticated with a different account
        await mcpServerViewProvider.syncMcpToken();
      }, 1000);
    }
  });

  // Sync MCP token at extension startup (after auth manager is ready)
  authManager.ready().then(async () => {
    if (authManager.isAuthenticated) {
      console.debug('Extension startup: Checking MCP server token sync...');
      await mcpServerViewProvider.syncMcpToken();
    }
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