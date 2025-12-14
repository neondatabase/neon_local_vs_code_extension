import React, { useEffect, useRef, useState } from 'react';
import { ViewData, NeonOrg, NeonProject, NeonBranch, NeonDatabase, NeonRole } from '../../types';
import { useStateService } from '../context/StateContext';
import { HelpIcon } from './HelpIcon';

interface MainAppProps {
  vscode: any;
}

interface ConnectionState {
    connected: boolean;
    isStarting: boolean;
    type: 'existing' | 'new';
    driver: 'serverless' | 'postgres';
    connectionInfo: string;
    currentlyConnectedBranch: string;
    selectedDatabase: string;
    selectedRole: string;
    databases: NeonDatabase[];
    roles: NeonRole[];
    selectedOrgId: string;
    selectedOrgName: string;
    selectedProjectId?: string;
    selectedProjectName?: string;
    selectedBranchId?: string;
    selectedBranchName?: string;
    parentBranchId?: string;
    parentBranchName?: string;
    persistentApiToken?: string;
}

export const MainApp: React.FC<MainAppProps> = ({ vscode }) => {
  const { state, updateState } = useStateService();
  const lastConnectedState = useRef<boolean>(false);
  const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isProcessingCommand, setIsProcessingCommand] = useState(false);
  // Ref to synchronously block rapid double-clicks before React state updates
  const processingRef = useRef(false);
  const [selectedConnectionDatabase, setSelectedConnectionDatabase] = useState<string>('');
  const [selectedConnectionRole, setSelectedConnectionRole] = useState<string>('');
  
  // Only show connected view if proxy is running AND we have a connection info
  // Add a small delay before showing disconnected state to prevent flicker
  const isConnected = state.connection.connected || (lastConnectedState.current && state.connection.isStarting);

  // Update lastConnectedState when connection state changes
  useEffect(() => {
    lastConnectedState.current = state.connection.connected;
    console.debug('Connection state changed:', {
      connected: state.connection.connected,
      isStarting: state.connection.isStarting,
      lastConnectedState: lastConnectedState.current,
      isConnected
    });
  }, [state.connection.connected, state.connection.isStarting]);


  // Handle messages from the extension
  useEffect(() => {
    if (!messageHandlerRef.current) {
      console.debug('Setting up message handler');
      messageHandlerRef.current = (event: MessageEvent) => {
        const message = event.data;
        console.debug('Received message from extension:', message);
        
        switch (message.command) {
          case 'updateViewData':
            console.debug('Handling updateViewData:', message.data);
            updateState({
              ...message.data,
              connection: {
                ...message.data.connection,
                databases: message.data.databases || [],
                roles: message.data.roles || []
              }
            });
            break;
            
          case 'clearState':
            console.debug('Clearing state');
            window.location.reload();
            break;

          case 'launchPsql':
            // Forward the command to the extension
            vscode.postMessage({ command: 'launchPsql' });
            break;

          case 'updateConnectionDatabaseRole':
            console.debug('Updating connection database/role:', message.database, message.role);
            setSelectedConnectionDatabase(message.database);
            setSelectedConnectionRole(message.role);
            break;
        }
      };
      
      window.addEventListener('message', messageHandlerRef.current);
      
      // Note: Initial data request is handled by StateContext.tsx
    }
    
    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener('message', messageHandlerRef.current);
      }
    };
  }, [vscode, updateState]);


  const handleImportToken = async () => {
    vscode.postMessage({
      command: 'importToken'
    });
  };

  const handleGenerateToken = () => {
    vscode.postMessage({
      command: 'openNeonConsole',
      path: '/app/settings#api-keys',
    });
  };

  const handleRefreshOrgs = () => {
    vscode.postMessage({
      command: 'refreshOrgs'
    });
  };

  const handleRefreshProjects = () => {
    if (state.connection.selectedOrgId) {
      vscode.postMessage({
        command: 'refreshProjects',
        orgId: state.connection.selectedOrgId
      });
    }
  };

  const handleRefreshBranches = () => {
    if (state.connection.selectedProjectId) {
      vscode.postMessage({
        command: 'refreshBranches',
        projectId: state.connection.selectedProjectId
      });
    }
  };

  const handleRefreshAll = () => {
    // Refresh organizations
    handleRefreshOrgs();
    
    // Refresh projects if an org is selected
    if (state.connection.selectedOrgId) {
      handleRefreshProjects();
    }
    
    // Refresh branches if a project is selected
    if (state.connection.selectedProjectId) {
      handleRefreshBranches();
    }
  };

  const handleOrgSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    console.debug('Organization selection changed:', event.target.value);
    const orgId = event.target.value;
    const selectedOrg = state.orgs.find(org => org.id === orgId);
    console.debug('Found org:', selectedOrg);
    
    // Clear all downstream selections and update state
    updateState({
        ...state,
        connection: {
            ...state.connection,
            selectedOrgId: orgId,
            selectedOrgName: selectedOrg?.name || 'Personal account',
            selectedProjectId: undefined,
            selectedProjectName: undefined,
            selectedBranchId: undefined,
            selectedBranchName: undefined,
            parentBranchId: undefined,
            parentBranchName: undefined
        },
        projects: [],
        branches: [],
        loading: {
            ...state.loading,
            projects: true,
            branches: false
        }
    });
    
    // Notify the extension
    vscode.postMessage({
        command: 'selectOrg',
        orgId,
        orgName: selectedOrg?.name || 'Personal account'
    });
  };

  const handleProjectSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const projectId = event.target.value;
    
    // Clear branches and reset state when no project is selected
    if (!projectId) {
      updateState({
        connection: {
          ...state.connection,
          selectedProjectId: undefined,
          selectedProjectName: undefined
        },
        branches: [],
        selectedBranchId: undefined,
        selectedBranchName: undefined,
        parentBranchId: undefined,
        parentBranchName: undefined,
        loading: {
          ...state.loading,
          branches: false
        }
      });
      return;
    }

    const selectedProject = state.projects.find(project => project.id === projectId);
    
    if (selectedProject) {
      updateState({
        connection: {
          ...state.connection,
          selectedProjectId: selectedProject.id,
          selectedProjectName: selectedProject.name
        },
        branches: [],
        selectedBranchId: undefined,
        selectedBranchName: undefined,
        parentBranchId: undefined,
        parentBranchName: undefined,
        loading: {
          ...state.loading,
          branches: true
        }
      });
      
      vscode.postMessage({
        command: 'selectProject',
        projectId: selectedProject.id,
        projectName: selectedProject.name
      });
    }
  };

  const handleBranchSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!state.connection.selectedProjectId) {
      return;
    }

    const branchId = event.target.value;
    
    // Handle create new branch option
    if (branchId === 'create_new') {
      vscode.postMessage({
        command: 'createNewBranch',
        projectId: state.connection.selectedProjectId
      });
      return;
    }

    const selectedBranch = state.branches.find(branch => branch.id === branchId);
    
    if (selectedBranch) {
      updateState({
        connection: {
          ...state.connection,
          selectedBranchId: selectedBranch.id,
          selectedBranchName: selectedBranch.name
        }
      });
      
      vscode.postMessage({
        command: 'selectBranch',
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        restartProxy: false
      });
    }
  };




  const handleStartProxy = () => {
    // Synchronously block if a start/stop operation is already in progress
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;
    setIsProcessingCommand(true);
    vscode.postMessage({
      command: 'startProxy',
      driver: state.connection.driver,
      branchId: state.connection.selectedBranchId,
      branchName: state.connection.selectedBranchName,
      orgId: state.connection.selectedOrgId,
      orgName: state.connection.selectedOrgName,
      projectId: state.connection.selectedProjectId,
      projectName: state.connection.selectedProjectName
    });
  };

  const handleStopProxy = () => {
    if (processingRef.current) {
      return;
    }

    processingRef.current = true;
    setIsProcessingCommand(true);
    vscode.postMessage({
      command: 'stopProxy'
    });
  };

  const handleAction = (action: string) => {
    vscode.postMessage({ command: action });
  };

  const handleCopy = async (text: string | undefined, type: string) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  // Build connection string for selected database and role
  const getConnectionStringForDatabaseRole = (): string => {
    if (!state.connection.branchConnectionInfos || state.connection.branchConnectionInfos.length === 0) {
      return '';
    }
    
    const connectionInfo = state.connection.branchConnectionInfos.find(
      info => info.database === selectedConnectionDatabase && info.user === selectedConnectionRole
    );
    
    if (!connectionInfo) {
      return '';
    }
    
    return `postgresql://${connectionInfo.user}:${connectionInfo.password}@${connectionInfo.host}/${connectionInfo.database}?sslmode=require`;
  };

  // Clear the processing lock ONLY when the extension reports that it is no longer
  // in the "starting" phase.  This prevents the Connect button from being
  // re-enabled too early (while the container is still launching).
  useEffect(() => {
    if (!state.connection.isStarting) {
      processingRef.current = false;
      setIsProcessingCommand(false);
    }
  }, [state.connection.isStarting, state.connection.connected]);

  // Initialize connection string selector with first available database/role
  useEffect(() => {
    if (state.connection.branchConnectionInfos && state.connection.branchConnectionInfos.length > 0) {
      if (!selectedConnectionDatabase) {
        setSelectedConnectionDatabase(state.connection.branchConnectionInfos[0].database);
        setSelectedConnectionRole(state.connection.branchConnectionInfos[0].user);
      }
    }
  }, [state.connection.branchConnectionInfos]);

  console.debug('state', state.connection);
  return (
    <div className="app">
      {isConnected ? (
        <>
          <div className="connection-status">
            <div className="status-indicator connected">
              <span className="status-dot"></span>
              Connected to branch
            </div>
          </div>

          <div className="connection-details">
            <div className="detail-row">
              <div className="detail-label">Organization</div>
              <div className="detail-value">{state.connection.selectedOrgName || 'Loading...'}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Project</div>
              <div className="detail-value">{state.connection.selectedProjectName || 'Loading...'}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Branch</div>
              <div className="detail-value">
                {state.connection.selectedBranchName || state.connection.selectedBranchId || 'Not selected'}
              </div>
            </div>

            {state.connection.branchConnectionInfos && state.connection.branchConnectionInfos.length > 0 && (
              <>
                <div className="detail-row">
                  <div className="detail-label-container">
                    <div className="detail-label">Connection String</div>
                    <button
                      className="copy-button"
                      title="Copy connection string"
                      onClick={() => handleCopy(getConnectionStringForDatabaseRole(), 'connection')}
                    >
                      {copySuccess === 'connection' ? (
                        <span>Copied</span>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" strokeWidth="1.5"/>
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="detail-value connection-string-container">
                    <div className="connection-string">{getConnectionStringForDatabaseRole()}</div>
                  </div>
                </div>
                <div style={{ marginTop: '4px', marginBottom: '8px' }}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      vscode.postMessage({
                        command: 'selectConnectionDatabaseRole',
                        currentDatabase: selectedConnectionDatabase,
                        currentRole: selectedConnectionRole
                      });
                    }}
                    style={{
                      color: 'var(--vscode-textLink-foreground)',
                      textDecoration: 'none',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    Change Database/Role
                  </a>
                </div>
              </>
            )}
          </div>

          <div className="section proxy-buttons">
            <button 
              onClick={handleStopProxy} 
              className="stop-button"
              disabled={isProcessingCommand}
            >
              {isProcessingCommand ? 'Disconnecting...' : 'Disconnect'}
            </button>

          </div>
        </>
      ) : (
        <>
          <div className="connection-header">
            <h2 className="connection-title">Connect to Neon branch</h2>
            <button 
              className="refresh-button" 
              onClick={handleRefreshAll}
              title="Refresh organizations, projects, and branches"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.65 2.35A7.95 7.95 0 0 0 8 0a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24l-1.5 1.5L13 7V2l-2 2z"/>
              </svg>
            </button>
          </div>

          <div className="form-content">
            <div className="section">
              <label htmlFor="org">Organization</label>
              <select
                id="org"
                value={state.connection.selectedOrgId ?? 'personal_account'}
                onChange={handleOrgSelection}
              >
                <option value="" disabled>Select an organization</option>
                {state.orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="section">
              <label htmlFor="project">Project</label>
              <select
                id="project"
                value={state.connection.selectedProjectId || ""}
                onChange={handleProjectSelection}
                disabled={!state.connection.selectedOrgId || state.connection.selectedOrgId === ""}
              >
                <option value="" disabled>Select a project</option>
                {state.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="section">
              <label htmlFor="branch">Branch</label>
              <select
                id="branch"
                value={state.connection.selectedBranchId || ""}
                onChange={handleBranchSelection}
                disabled={!state.connection.selectedProjectId}
              >
                <option value="" disabled>Select a branch</option>
                {state.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
                <option value="create_new">Create new branch...</option>
              </select>
            </div>

            <div className="section proxy-buttons">
              <button
                onClick={handleStartProxy}
                disabled={isProcessingCommand || !state.connection.selectedProjectId || !state.connection.selectedBranchId}
                className="start-button"
              >
                {isProcessingCommand ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}; 


