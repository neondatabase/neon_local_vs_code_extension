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
  const [portInputValue, setPortInputValue] = useState<string>('');
  const [portError, setPortError] = useState<string | null>(null);
  
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

  // Sync port input value with state
  useEffect(() => {
    setPortInputValue(state.connection.port.toString() || '5432');
  }, [state.connection.port]);

  // Helper function to validate port
  const isValidPort = (port: number | string): boolean => {
    const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
    return !isNaN(portNum) && portNum >= 1024 && portNum <= 65535;
  };

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

  const handleConnectionTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const type = event.target.value as 'existing' | 'new';
    vscode.postMessage({
        command: 'updateConnectionType',
        connectionType: type
    });
  };

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
      if (state.connection.type === 'existing') {
        updateState({
          connection: {
            ...state.connection,
            selectedBranchId: selectedBranch.id,
            selectedBranchName: selectedBranch.name
          }
        });
      } else {
        updateState({
          connection: {
            ...state.connection,
            parentBranchId: selectedBranch.id,
            parentBranchName: selectedBranch.name
          }
        });
      }
      
      vscode.postMessage({
        command: 'selectBranch',
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        restartProxy: false
      });
    }
  };

  const handleRefreshBranches = () => {
    if (!state.connection.selectedProjectId) {
      return;
    }
    updateState({
      loading: {
        ...state.loading,
        branches: true
      }
    });
    vscode.postMessage({
      command: 'refreshBranches',
      projectId: state.connection.selectedProjectId
    });
  };



  const handlePortChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    
    // Update local input value immediately to allow typing
    setPortInputValue(value);
    
    // Clear any existing error when user starts typing
    setPortError(null);
    
    // If empty, don't validate yet (allow user to type)
    if (value === '') {
      return;
    }
    
    const port = parseInt(value, 10);
    // Update state for any numeric input
    if (!isNaN(port)) {
      updateState({ connection: { ...state.connection, port } });
      
      // Validate port range and set error if invalid
      if (!isValidPort(port)) {
        setPortError('Port must be between 1024 and 65535');
      }
      
      // Only send valid ports to the extension
      if (isValidPort(port)) {
        vscode.postMessage({
          command: 'updatePort',
          port
        });
      }
    } else {
      setPortError('Port must be a valid number');
    }
  };

  const handlePortBlur = () => {
    // On blur, validate the current value
    if (portInputValue === '') {
      setPortError('Port is required');
    } else {
      const port = parseInt(portInputValue, 10);
      if (isNaN(port)) {
        setPortError('Port must be a valid number');
      } else if (!isValidPort(port)) {
        setPortError('Port must be between 1024 and 65535');
      }
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
      isExisting: state.connection.type === 'existing',
      branchId: state.connection.selectedBranchId,
      branchName: state.connection.selectedBranchName,
      parentBranchId: state.connection.parentBranchId,
      parentBranchName: state.connection.parentBranchName,
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

  // Clear the processing lock ONLY when the extension reports that it is no longer
  // in the "starting" phase.  This prevents the Connect button from being
  // re-enabled too early (while the container is still launching).
  useEffect(() => {
    if (!state.connection.isStarting) {
      processingRef.current = false;
      setIsProcessingCommand(false);
    }
  }, [state.connection.isStarting, state.connection.connected]);

  console.debug('state', state.connection);
  return (
    <div className="app">
      {isConnected ? (
        <>
          <div className="connection-status">
            <div className="status-indicator connected">
              <span className="status-dot"></span>
              Connected to {state.connection.type === 'new' ? 'ephemeral' : ''} branch
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
                {state.connection.type === 'new' 
                  ? (state.connection.currentlyConnectedBranch || 'Not selected')
                  : (state.connection.selectedBranchName || state.connection.selectedBranchId || 'Not selected')}
              </div>
            </div>
            {state.connection.type === 'new' && (
              <div className="detail-row">
                <div className="detail-label">Parent Branch</div>
                <div className="detail-value">{state.connection.parentBranchName || state.connection.parentBranchId || 'Not selected'}</div>
              </div>
            )}

            {state.connectionInfo && (
              <div>
                <div className="detail-row">
                  <div className="detail-label-container">
                    <div className="detail-label">Local Connection String</div>
                    <button
                      className="copy-button"
                      title="Copy connection string"
                      onClick={() => handleCopy(state.connectionInfo, 'connection')}
                    >
                      {copySuccess === 'connection' ? (
                        <span>✓</span>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" strokeWidth="1.5"/>
                          <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                      )}
                    </button>
                  </div>
                  <div className="detail-value connection-string-container">
                    <div className="connection-string">{state.connectionInfo}</div>
                  </div>
                </div>
              </div>
            )}
            {state.selectedDriver === 'serverless' && (
              <div>
                <div className="detail-row">
                  <div className="detail-label-container">
                    <div className="label-with-help">
                      <div className="detail-label">Local Fetch Endpoint</div>
                      <HelpIcon 
                        tooltip="When connecting to your database's local connection string with the Neon serverless driver, you must also set the local fetch endpoint in your app's Neon config."
                      />
                    </div>
                    <button
                      className="copy-button"
                      title="Copy fetch endpoint configuration"
                      onClick={() => handleCopy(`import { neonConfig } from '@neondatabase/serverless';\n\nneonConfig.fetchEndpoint = 'http://localhost:${state.port}/sql';`, 'endpoint')}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10.75 1.75H4.25C3.97386 1.75 3.75 1.97386 3.75 2.25V11.25C3.75 11.5261 3.97386 11.75 4.25 11.75H10.75C11.0261 11.75 11.25 11.5261 11.25 11.25V2.25C11.25 1.97386 11.0261 1.75 10.75 1.75Z" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M12.25 4.25H13.75V13.75H5.75V12.25" stroke="currentColor" strokeWidth="1.5"/>
                      </svg>
                      <span className={`copy-success ${copySuccess === 'endpoint' ? 'visible' : ''}`}>
                        Copied!
                      </span>
                    </button>
                  </div>
                  <div className="detail-value connection-string-container">
                    <div className="connection-string">
                      import {'{'} neonConfig {'}'} from '@neondatabase/serverless';<br /><br />
                      neonConfig.fetchEndpoint = 'http://localhost:{state.port}/sql';<br /><br />
                    </div>
                  </div>
                </div>
              </div>
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
          <div className="form-content">
            <div className="section">
              <div className="label-with-help">
                <label htmlFor="connection-type">Connection Type</label>
                <HelpIcon 
                  tooltip="Connect to an existing Neon branch or a new ephemeral branch that will be automatically deleted when you disconnect."
                  className="tooltip-below"
                />
              </div>
              <select
                id="connection-type"
                value={state.connection.type}
                onChange={handleConnectionTypeChange}
              >
                <option value="existing">Connect to Neon branch</option>
                <option value="new">Connect to ephemeral Neon branch</option>
              </select>
            </div>

            {state.connection.type === 'new' && !state.connection.persistentApiToken ? (
              <div className="token-requirement">
                <p>Ephemeral branches require a persistent API token. Generate a persistent API token and import it to connect to ephemeral Neon branches.</p>
                <div className="token-actions">
                  <button onClick={handleGenerateToken} className="token-button">
                    Create API Key
                  </button>
                  <button onClick={handleImportToken} className="token-button">
                    Import API Key
                  </button>
                </div>
              </div>
            ) : (
              <>
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

                {state.connection.type === 'existing' ? (
                  <div className="section">
                    <label htmlFor="branch">Branch</label>
                    <div className="select-with-action">
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
                      <button
                        className="refresh-button"
                        onClick={handleRefreshBranches}
                        disabled={!state.connection.selectedProjectId || state.loading.branches}
                        title="Refresh branches"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className={state.loading.branches ? 'spinning' : ''}>
                          <path fillRule="evenodd" d="M4.755 10.059a7.5 7.5 0 0 1 12.548-3.364l1.903 1.903h-3.183a.75.75 0 1 0 0 1.5h4.992a.75.75 0 0 0 .75-.75V4.356a.75.75 0 0 0-1.5 0v3.18l-1.9-1.9A9 9 0 0 0 3.306 9.67a.75.75 0 1 0 1.45.388Zm15.408 3.352a.75.75 0 0 0-.919.53 7.5 7.5 0 0 1-12.548 3.364l-1.902-1.903h3.183a.75.75 0 0 0 0-1.5H2.984a.75.75 0 0 0-.75.75v4.992a.75.75 0 0 0 1.5 0v-3.18l1.9 1.9a9 9 0 0 0 15.059-4.035.75.75 0 0 0-.53-.918Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="section">
                    <label htmlFor="parent-branch">Parent Branch</label>
                    <div className="select-with-action">
                      <select
                        id="parent-branch"
                        value={state.connection.parentBranchId || ""}
                        onChange={handleBranchSelection}
                        disabled={!state.connection.selectedProjectId}
                      >
                        <option value="" disabled>Select a parent branch</option>
                        {state.branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="refresh-button"
                        onClick={handleRefreshBranches}
                        disabled={!state.connection.selectedProjectId || state.loading.branches}
                        title="Refresh branches"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className={state.loading.branches ? 'spinning' : ''}>
                          <path fillRule="evenodd" d="M4.755 10.059a7.5 7.5 0 0 1 12.548-3.364l1.903 1.903h-3.183a.75.75 0 1 0 0 1.5h4.992a.75.75 0 0 0 .75-.75V4.356a.75.75 0 0 0-1.5 0v3.18l-1.9-1.9A9 9 0 0 0 3.306 9.67a.75.75 0 1 0 1.45.388Zm15.408 3.352a.75.75 0 0 0-.919.53 7.5 7.5 0 0 1-12.548 3.364l-1.902-1.903h3.183a.75.75 0 0 0 0-1.5H2.984a.75.75 0 0 0-.75.75v4.992a.75.75 0 0 0 1.5 0v-3.18l1.9 1.9a9 9 0 0 0 15.059-4.035.75.75 0 0 0-.53-.918Z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}



                <div className="section">
                  <div className="label-with-help">
                    <label htmlFor="port">Database Port</label>
                    <HelpIcon 
                      tooltip="Local port for the database proxy container. Default is 5432. Must be between 1024-65535."
                    />
                  </div>
                  <input
                    type="number"
                    id="port"
                    min="1024"
                    max="65535"
                    value={portInputValue}
                    onChange={handlePortChange}
                    onBlur={handlePortBlur}
                    className={portError ? 'error' : ''}
                  />
                  {portError && (
                    <div className="field-error">
                      {portError}
                    </div>
                  )}
                </div>

                <div className="section proxy-buttons">
                  <button
                    onClick={handleStartProxy}
                    disabled={isProcessingCommand || !state.connection.selectedProjectId || (state.connection.type === 'existing' ? !state.connection.selectedBranchId : !state.connection.parentBranchId) || !!portError || !isValidPort(portInputValue)}
                    className="start-button"
                  >
                    {isProcessingCommand ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}; 