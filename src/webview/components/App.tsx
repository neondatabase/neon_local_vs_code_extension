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
  const [activeTab, setActiveTab] = useState<'app' | 'allBranches'>('app'); // Default to 'app', will be overridden by saved preference
  // Ref to track current activeTab for use in message handlers (avoids stale closure)
  const activeTabRef = useRef<'app' | 'allBranches'>('app');
  const hasReceivedTabPreference = useRef(false); // Track if we've received the preference to avoid overwriting user changes
  const [workspaceName, setWorkspaceName] = useState<string>('');
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);
  const [isBackgroundScanning, setIsBackgroundScanning] = useState(false);
  const backgroundScanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [detectedConnections, setDetectedConnections] = useState<Array<{
    file: string;
    connectionString: string;
    database?: string;
    projectId?: string;
    branchId?: string;
    endpointId?: string;
    projectName?: string;
    branchName?: string;
    orgName?: string;
    orgId?: string;
    error?: string;
  }>>([]);
  
  // Filtered lists for App tab based on detected connections
  const [filteredOrgs, setFilteredOrgs] = useState<NeonOrg[]>([]);
  const [filteredProjects, setFilteredProjects] = useState<NeonProject[]>([]);
  const [filteredBranches, setFilteredBranches] = useState<NeonBranch[]>([]);
  
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

  // Keep activeTabRef in sync with activeTab state (for use in message handlers)
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Handle tab change - update state and persist preference
  const handleTabChange = (newTab: 'app' | 'allBranches') => {
    setActiveTab(newTab);
    activeTabRef.current = newTab;
    // Persist the preference
    vscode.postMessage({ command: 'saveTabPreference', tab: newTab });
  };

  // Scan for connections when switching to app tab
  useEffect(() => {
    if (activeTab === 'app') {
      // Scan if we haven't already
      if (detectedConnections.length === 0 && !isLoadingConnections) {
        setIsLoadingConnections(true);
        vscode.postMessage({ command: 'scanWorkspaceForConnections' });
      }
      // Clear selections when switching to app tab to trigger auto-selection
      if (state.connection.selectedOrgId || state.connection.selectedProjectId || state.connection.selectedBranchId) {
        updateState({
          connection: {
            ...state.connection,
            selectedOrgId: '',
            selectedOrgName: '',
            selectedProjectId: undefined,
            selectedProjectName: undefined,
            selectedBranchId: undefined,
            selectedBranchName: undefined
          }
        });
      }
    }
  }, [activeTab]);

  // Periodic background rescan when no connections are detected
  useEffect(() => {
    // Clear any existing interval
    if (backgroundScanIntervalRef.current) {
      clearInterval(backgroundScanIntervalRef.current);
      backgroundScanIntervalRef.current = null;
    }

    // Only set up interval if:
    // - We're on the app tab
    // - No connections detected (or all have errors)
    // - Not currently doing a foreground scan
    const validConnections = detectedConnections.filter(c => !c.error);
    const shouldRunBackgroundScans = 
      activeTab === 'app' && 
      validConnections.length === 0 && 
      !isLoadingConnections;

    if (shouldRunBackgroundScans) {
      console.debug('Setting up background rescan interval (10s)');
      backgroundScanIntervalRef.current = setInterval(() => {
        if (!isBackgroundScanning && !isLoadingConnections) {
          console.debug('Running background rescan for connection strings...');
          setIsBackgroundScanning(true);
          vscode.postMessage({ command: 'backgroundScanWorkspaceForConnections' });
        }
      }, 10000); // 10 seconds
    }

    // Cleanup on unmount or when conditions change
    return () => {
      if (backgroundScanIntervalRef.current) {
        clearInterval(backgroundScanIntervalRef.current);
        backgroundScanIntervalRef.current = null;
      }
    };
  }, [activeTab, detectedConnections, isLoadingConnections]);

  // Track if we've already requested data for detected connections to avoid duplicate requests
  const requestedProjectsForOrg = useRef<string | null>(null);
  const requestedBranchesForProject = useRef<string | null>(null);

  // Update filtered lists when detected connections or state data changes
  useEffect(() => {
    // Only consider valid connections (without errors) for filtering
    const validConnections = detectedConnections.filter(c => !c.error);
    
    if (validConnections.length === 0) {
      setFilteredOrgs([]);
      setFilteredProjects([]);
      setFilteredBranches([]);
      requestedProjectsForOrg.current = null;
      requestedBranchesForProject.current = null;
      return;
    }

    // Extract unique org IDs from valid detected connections
    const uniqueOrgIds = new Set(validConnections.map(c => c.orgId).filter(Boolean));
    const orgsForApp = state.orgs.filter(org => uniqueOrgIds.has(org.id));
    setFilteredOrgs(orgsForApp);

    // Track effective IDs (handles auto-selection in same render cycle)
    let effectiveOrgId = state.connection.selectedOrgId;
    let effectiveProjectId = state.connection.selectedProjectId;

    // On app tab, if current org selection is not in the filtered list, clear all selections
    if (activeTab === 'app' && state.connection.selectedOrgId && !uniqueOrgIds.has(state.connection.selectedOrgId)) {
      console.debug('Clearing stale org selection (not in detected connections):', state.connection.selectedOrgId);
      effectiveOrgId = '';
      effectiveProjectId = undefined;
      updateState({
        connection: {
          ...state.connection,
          selectedOrgId: '',
          selectedOrgName: '',
          selectedProjectId: undefined,
          selectedProjectName: undefined,
          selectedBranchId: undefined,
          selectedBranchName: undefined
        }
      });
    }

    // Auto-select org if there's only one and on app tab (or if selection was just cleared)
    const shouldAutoSelectOrg = activeTab === 'app' && orgsForApp.length === 1 &&
      (!state.connection.selectedOrgId || !uniqueOrgIds.has(state.connection.selectedOrgId));
    if (shouldAutoSelectOrg) {
      const org = orgsForApp[0];
      console.debug('Auto-selecting org:', org.id, org.name);
      effectiveOrgId = org.id;
      updateState({
        connection: {
          ...state.connection,
          selectedOrgId: org.id,
          selectedOrgName: org.name
        }
      });
      vscode.postMessage({
        command: 'selectOrg',
        orgId: org.id,
        orgName: org.name
      });
    }

    // Filter projects based on selected/auto-selected org for app tab
    if (effectiveOrgId) {
      const uniqueProjectIds = new Set(
        validConnections
          .filter(c => c.orgId === effectiveOrgId)
          .map(c => c.projectId)
          .filter(Boolean)
      );
      
      // If we have detected projects but state.projects is empty or doesn't have them,
      // and we haven't already requested them, request projects to be fetched
      const detectedProjectIds = Array.from(uniqueProjectIds);
      const hasDetectedProjects = detectedProjectIds.length > 0;
      const projectsLoaded = detectedProjectIds.some(pid => state.projects.some(p => p.id === pid));
      
      if (hasDetectedProjects && !projectsLoaded && requestedProjectsForOrg.current !== effectiveOrgId) {
        console.debug('Detected projects not in state, requesting projects for org:', effectiveOrgId);
        requestedProjectsForOrg.current = effectiveOrgId;
        vscode.postMessage({
          command: 'refreshProjects',
          orgId: effectiveOrgId
        });
      }
      
      const projectsForApp = state.projects.filter(p => uniqueProjectIds.has(p.id));
      setFilteredProjects(projectsForApp);

      // On app tab, if current selection is not in the filtered list, clear it
      // This handles when there's a stale selection from a previous session
      if (activeTab === 'app' && state.connection.selectedProjectId && !uniqueProjectIds.has(state.connection.selectedProjectId)) {
        console.debug('Clearing stale project selection (not in detected connections):', state.connection.selectedProjectId);
        updateState({
          connection: {
            ...state.connection,
            selectedProjectId: undefined,
            selectedProjectName: undefined,
            selectedBranchId: undefined,
            selectedBranchName: undefined
          }
        });
        // Also reset the effective IDs for this render cycle
        effectiveProjectId = undefined;
      }

      // Auto-select project if there's only one and on app tab (or if selection was just cleared)
      const shouldAutoSelectProject = activeTab === 'app' && projectsForApp.length === 1 && 
        (!state.connection.selectedProjectId || !uniqueProjectIds.has(state.connection.selectedProjectId));
      if (shouldAutoSelectProject) {
        const project = projectsForApp[0];
        console.debug('Auto-selecting project:', project.id, project.name);
        // Set effective project ID for branch filtering in this same render
        effectiveProjectId = project.id;
        updateState({
          connection: {
            ...state.connection,
            selectedProjectId: project.id,
            selectedProjectName: project.name
          }
        });
        vscode.postMessage({
          command: 'selectProject',
          projectId: project.id,
          projectName: project.name
        });
        // Also explicitly request branches for this project to ensure they're loaded
        console.debug('Requesting branches for auto-selected project:', project.id);
        requestedBranchesForProject.current = project.id;
        vscode.postMessage({
          command: 'refreshBranches',
          projectId: project.id
        });
      }
    } else {
      setFilteredProjects([]);
    }

    // Filter branches based on selected/auto-selected project for app tab
    const currentProjectId = effectiveProjectId;
    if (currentProjectId) {
      const uniqueBranchIds = new Set(
        validConnections
          .filter(c => c.projectId === currentProjectId)
          .map(c => c.branchId)
          .filter(Boolean)
      );
      
      // If we have detected branches but state.branches is empty or doesn't have them,
      // and we haven't already requested them, request branches to be fetched
      const detectedBranchIds = Array.from(uniqueBranchIds);
      const hasDetectedBranches = detectedBranchIds.length > 0;
      const branchesLoaded = detectedBranchIds.some(bid => state.branches.some(b => b.id === bid));
      
      if (hasDetectedBranches && !branchesLoaded && requestedBranchesForProject.current !== currentProjectId) {
        console.debug('Detected branches not in state, requesting branches for project:', currentProjectId);
        requestedBranchesForProject.current = currentProjectId;
        vscode.postMessage({
          command: 'refreshBranches',
          projectId: currentProjectId
        });
      }
      
      const branchesForApp = state.branches.filter(b => uniqueBranchIds.has(b.id));
      console.debug('Branch filtering:', {
        selectedProjectId: currentProjectId,
        totalBranches: state.branches.length,
        detectedBranchIds: detectedBranchIds,
        filteredBranches: branchesForApp.length,
        branchNames: branchesForApp.map(b => b.name)
      });
      setFilteredBranches(branchesForApp);

      // On app tab, if current branch selection is not in the filtered list, clear it
      if (activeTab === 'app' && state.connection.selectedBranchId && !uniqueBranchIds.has(state.connection.selectedBranchId)) {
        console.debug('Clearing stale branch selection (not in detected connections):', state.connection.selectedBranchId);
        updateState({
          connection: {
            ...state.connection,
            selectedBranchId: undefined,
            selectedBranchName: undefined
          }
        });
      }

      // Auto-select branch if there's only one and on app tab (or if selection was just cleared)
      const shouldAutoSelectBranch = activeTab === 'app' && branchesForApp.length === 1 &&
        (!state.connection.selectedBranchId || !uniqueBranchIds.has(state.connection.selectedBranchId));
      if (shouldAutoSelectBranch) {
        const branch = branchesForApp[0];
        console.debug('Auto-selecting branch:', branch.id, branch.name);
        updateState({
          connection: {
            ...state.connection,
            selectedBranchId: branch.id,
            selectedBranchName: branch.name
          }
        });
        vscode.postMessage({
          command: 'selectBranch',
          branchId: branch.id,
          branchName: branch.name,
          restartProxy: false
        });
      }
    } else {
      setFilteredBranches([]);
    }
  }, [detectedConnections, state.orgs, state.projects, state.branches, state.connection.selectedOrgId, state.connection.selectedProjectId, activeTab]);

  // Ensure branches are loaded when project is selected on app tab
  // This handles the case where branches need to be fetched after project auto-selection
  useEffect(() => {
    if (activeTab !== 'app' || !state.connection.selectedProjectId || detectedConnections.length === 0) {
      return;
    }
    
    const validConnections = detectedConnections.filter(c => !c.error);
    const detectedBranchIds = validConnections
      .filter(c => c.projectId === state.connection.selectedProjectId)
      .map(c => c.branchId)
      .filter(Boolean);
    
    if (detectedBranchIds.length === 0) {
      return;
    }
    
    // Check if branches are loaded
    const branchesLoaded = detectedBranchIds.some(bid => state.branches.some(b => b.id === bid));
    
    if (!branchesLoaded && requestedBranchesForProject.current !== state.connection.selectedProjectId) {
      console.debug('Branches effect: requesting branches for project:', state.connection.selectedProjectId);
      requestedBranchesForProject.current = state.connection.selectedProjectId;
      vscode.postMessage({
        command: 'refreshBranches',
        projectId: state.connection.selectedProjectId
      });
    }
  }, [activeTab, state.connection.selectedProjectId, state.branches, detectedConnections]);


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
          
          case 'workspaceInfo':
            console.debug('Received workspace info:', message);
            setWorkspaceName(message.workspaceName || '');
            break;
          
          case 'tabPreference':
            console.debug('Received tab preference:', message.tab);
            // Only apply if we haven't received the preference yet (avoid overwriting user changes)
            if (!hasReceivedTabPreference.current) {
              hasReceivedTabPreference.current = true;
              const preferredTab = message.tab || 'app'; // Default to 'app' if no preference saved
              setActiveTab(preferredTab);
              activeTabRef.current = preferredTab;
            }
            break;
          
          case 'scanningStarted':
            console.debug('Backend confirmed scanning started, activeTab:', activeTabRef.current);
            // Ensure loading state is shown (use ref to avoid stale closure)
            if (activeTabRef.current === 'app') {
              setIsLoadingConnections(true);
              setDetectedConnections([]);
            }
            break;
          
          case 'connectionStringsFound':
            // Connection strings were found, but API calls are still in progress to get org/project/branch info
            // Show loading state while enrichment happens
            // Note: This message is only sent when the backend needs to do API enrichment
            // (either foreground scan, or background scan that detected changes)
            console.debug('Connection strings found, enriching with API data...', message.count);
            if (activeTabRef.current === 'app') {
              setIsLoadingConnections(true);
              // If this was a background scan that detected changes, reset the flag
              // since we're now doing a full enrichment with loading UI
              setIsBackgroundScanning(false);
            }
            break;
          
          case 'detectedConnections':
            console.debug('Received detected connections:', message.connections);
            console.debug('Connection details:', message.connections?.map((c: any) => ({
              file: c.file,
              orgId: c.orgId,
              orgName: c.orgName,
              projectId: c.projectId,
              projectName: c.projectName,
              branchId: c.branchId,
              branchName: c.branchName
            })));
            setDetectedConnections(message.connections || []);
            setIsLoadingConnections(false);
            setIsBackgroundScanning(false);
            break;
          
          case 'triggerRefresh':
            console.debug('Triggering refresh from title bar');
            handleRefreshAll();
            break;
        }
      };
      
      window.addEventListener('message', messageHandlerRef.current);
      
      // Request workspace info and tab preference
      vscode.postMessage({ command: 'getWorkspaceInfo' });
      vscode.postMessage({ command: 'getTabPreference' });
      
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
    // Use ref to get current activeTab value (avoids stale closure in message handlers)
    const currentActiveTab = activeTabRef.current;
    console.debug('handleRefreshAll called, activeTab:', currentActiveTab);
    
    // Always set loading state first when on app tab, before any other operations
    if (currentActiveTab === 'app') {
      console.debug('On app tab - showing loading screen');
      // Clear all app tab state to show loading screen
      setDetectedConnections([]);
      setFilteredOrgs([]);
      setFilteredProjects([]);
      setFilteredBranches([]);
      setIsLoadingConnections(true);
      
      // Clear selections to prepare for fresh data
      updateState({
        connection: {
          ...state.connection,
          selectedOrgId: '',
          selectedOrgName: '',
          selectedProjectId: undefined,
          selectedProjectName: undefined,
          selectedBranchId: undefined,
          selectedBranchName: undefined
        }
      });
    }
    
    // Tell backend to clear cache and re-scan (always do this regardless of tab)
    vscode.postMessage({ command: 'refreshWorkspaceConnections', forceRefresh: true });
    
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
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'app' ? 'active' : ''}`}
              onClick={() => handleTabChange('app')}
              title={workspaceName || 'workspace'}
            >
              <span className="tab-text">{workspaceName || 'workspace'}</span>
            </button>
            <button
              className={`tab ${activeTab === 'allBranches' ? 'active' : ''}`}
              onClick={() => handleTabChange('allBranches')}
              title="All branches"
            >
              <span className="tab-text">All branches</span>
            </button>
          </div>

          {activeTab === 'allBranches' ? (
            <div className="form-content">
            <div style={{ 
              fontSize: '14px', 
              fontWeight: 400, 
              color: 'var(--vscode-descriptionForeground)', 
              marginBottom: '16px' 
            }}>
              Connect to Neon branch
            </div>
            <div className="section">
              <label htmlFor="org">Organization</label>
              <select
                id="org"
                value={state.connection.selectedOrgId || ''}
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
          ) : (
            <div className="form-content">
              {isLoadingConnections ? (
                <div style={{ 
                  padding: '20px 24px', 
                  textAlign: 'center',
                  background: 'var(--vscode-editor-background)',
                  border: '1px solid var(--vscode-panel-border)',
                  borderRadius: '6px'
                }}>
                  <div style={{ 
                    marginBottom: '16px',
                    animation: 'pulse 1.5s ease-in-out infinite',
                    display: 'flex',
                    justifyContent: 'center'
                  }}>
                    <svg width="28" height="28" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="6.5" cy="6.5" r="5" stroke="var(--vscode-foreground)" strokeWidth="1.5"/>
                      <path d="M10.5 10.5L14.5 14.5" stroke="var(--vscode-foreground)" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: 500,
                    color: 'var(--vscode-foreground)',
                    marginBottom: '8px'
                  }}>
                    Scanning repo for connection strings
                  </div>
                  <div style={{ 
                    fontSize: '12px',
                    color: 'var(--vscode-descriptionForeground)',
                    lineHeight: '1.5'
                  }}>
                    Looking through workspace files and fetching branch details from the Neon API...
                  </div>
                </div>
              ) : detectedConnections.length === 0 || detectedConnections.every(c => c.error) ? (
                <div>
                  {/* Show error banner if there are unmatched connections */}
                  {detectedConnections.length > 0 && detectedConnections.every(c => c.error) && (
                    <div style={{
                      padding: '8px 12px',
                      marginBottom: '16px',
                      background: 'var(--vscode-inputValidation-warningBackground, rgba(255, 204, 0, 0.1))',
                      border: '1px solid var(--vscode-inputValidation-warningBorder, #cca700)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: 'var(--vscode-foreground)'
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px',
                        marginBottom: '8px'
                      }}>
                        <span style={{ fontSize: '14px' }}>⚠️</span>
                        <span style={{ fontWeight: 500 }}>
                          {detectedConnections.length === 1 
                            ? 'Connection string found but could not be matched' 
                            : `${detectedConnections.length} connection strings found but could not be matched`}
                        </span>
                      </div>
                      <div style={{ 
                        marginLeft: '22px', 
                        fontSize: '11px', 
                        color: 'var(--vscode-descriptionForeground)',
                        lineHeight: '1.4'
                      }}>
                        {detectedConnections.map((conn, idx) => (
                          <div key={idx} style={{ marginTop: idx > 0 ? '4px' : '0' }}>
                            <code 
                              onClick={() => vscode.postMessage({ command: 'openFile', file: conn.file })}
                              style={{ 
                                background: 'var(--vscode-textCodeBlock-background)', 
                                padding: '1px 4px', 
                                borderRadius: '2px',
                                fontSize: '10px',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                textDecorationColor: 'var(--vscode-textLink-foreground)',
                                color: 'var(--vscode-textLink-foreground)'
                              }}
                              onMouseOver={(e) => {
                                e.currentTarget.style.textDecorationColor = 'var(--vscode-textLink-activeForeground)';
                                e.currentTarget.style.color = 'var(--vscode-textLink-activeForeground)';
                              }}
                              onMouseOut={(e) => {
                                e.currentTarget.style.textDecorationColor = 'var(--vscode-textLink-foreground)';
                                e.currentTarget.style.color = 'var(--vscode-textLink-foreground)';
                              }}
                            >
                              {conn.file}
                            </code>
                            <span style={{ marginLeft: '6px', opacity: 0.8 }}>{conn.error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ 
                    padding: '16px', 
                    background: 'var(--vscode-editor-background)', 
                    border: '1px solid var(--vscode-panel-border)',
                    borderRadius: '4px',
                    fontSize: '13px',
                    color: 'var(--vscode-descriptionForeground)'
                  }}>
                    <div style={{ fontWeight: 500, fontSize: '14px', marginBottom: '8px', color: 'var(--vscode-foreground)' }}>
                      {detectedConnections.length === 0 
                        ? 'No Neon connection strings detected in this workspace.'
                        : 'No accessible Neon branches found.'}
                    </div>
                    <div style={{ lineHeight: '1.5' }}>
                      {detectedConnections.length === 0 
                        ? <>To get started and connect your app to a Neon database, open up the agent chat and type <strong style={{ color: 'var(--vscode-foreground)' }}>Get started with Neon</strong> to begin.</>
                        : <>The connection strings in this repo reference projects or branches you don't have access to. If these branches belong to a different Neon account, sign out and sign back in with the correct account. Otherwise, use the <strong style={{ color: 'var(--vscode-foreground)' }}>All branches</strong> tab to connect to a different branch.</>
                      }
                    </div>
                    {detectedConnections.length > 0 && (
                      <button
                        onClick={() => {
                          vscode.postMessage({ command: 'signOut' });
                        }}
                        style={{
                          marginTop: '16px',
                          width: '100%',
                          padding: '10px 16px',
                          background: 'var(--vscode-button-secondaryBackground)',
                          color: 'var(--vscode-button-secondaryForeground)',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.background = 'var(--vscode-button-secondaryHoverBackground)';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.background = 'var(--vscode-button-secondaryBackground)';
                        }}
                      >
                        Sign out
                      </button>
                    )}
                    {detectedConnections.length === 0 && (
                      <button
                        onClick={() => {
                          vscode.postMessage({
                            command: 'openChatWithPrompt',
                            prompt: 'Get started with Neon.'
                          });
                        }}
                        style={{
                          marginTop: '16px',
                          width: '100%',
                          padding: '10px 16px',
                          background: 'var(--vscode-button-background)',
                          color: 'var(--vscode-button-foreground)',
                          border: 'none',
                          borderRadius: '4px',
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.background = 'var(--vscode-button-hoverBackground)';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.background = 'var(--vscode-button-background)';
                        }}
                      >
                        <span>Get started with Neon</span>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M14 1H2C1.44772 1 1 1.44772 1 2V10C1 10.5523 1.44772 11 2 11H4V14L8 11H14C14.5523 11 15 10.5523 15 10V2C15 1.44772 14.5523 1 14 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Valid connections banner */}
                  {detectedConnections.filter(c => !c.error).length > 0 && (
                    <div style={{
                      padding: '8px 12px',
                      marginBottom: detectedConnections.some(c => c.error) ? '8px' : '16px',
                      background: 'var(--vscode-textCodeBlock-background)',
                      border: '1px solid var(--vscode-panel-border)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: 'var(--vscode-descriptionForeground)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                        <circle cx="4" cy="4" r="2" stroke="var(--vscode-charts-green)" strokeWidth="1.5"/>
                        <circle cx="4" cy="12" r="2" stroke="var(--vscode-charts-green)" strokeWidth="1.5"/>
                        <circle cx="12" cy="4" r="2" stroke="var(--vscode-charts-green)" strokeWidth="1.5"/>
                        <path d="M4 6V10" stroke="var(--vscode-charts-green)" strokeWidth="1.5"/>
                        <path d="M12 6V8C12 9.10457 11.1046 10 10 10H6" stroke="var(--vscode-charts-green)" strokeWidth="1.5"/>
                      </svg>
                      <span>
                        {detectedConnections.filter(c => !c.error).length === 1 
                          ? '1 branch detected in this repo' 
                          : `${detectedConnections.filter(c => !c.error).length} branches detected in this repo`}
                      </span>
                    </div>
                  )}

                  {/* Unmatched connections warning */}
                  {detectedConnections.some(c => c.error) && (
                    <div style={{
                      padding: '8px 12px',
                      marginBottom: '16px',
                      background: 'var(--vscode-inputValidation-warningBackground, rgba(255, 204, 0, 0.1))',
                      border: '1px solid var(--vscode-inputValidation-warningBorder, #cca700)',
                      borderRadius: '4px',
                      fontSize: '12px',
                      color: 'var(--vscode-foreground)'
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px',
                        marginBottom: detectedConnections.filter(c => c.error).length > 1 ? '8px' : '0'
                      }}>
                        <span style={{ fontSize: '14px' }}>⚠️</span>
                        <span style={{ fontWeight: 500 }}>
                          {detectedConnections.filter(c => c.error).length === 1 
                            ? '1 connection string could not be matched' 
                            : `${detectedConnections.filter(c => c.error).length} connection strings could not be matched`}
                        </span>
                      </div>
                      <div style={{ 
                        marginLeft: '22px', 
                        fontSize: '11px', 
                        color: 'var(--vscode-descriptionForeground)',
                        lineHeight: '1.4'
                      }}>
                        {detectedConnections.filter(c => c.error).map((conn, idx) => (
                          <div key={idx} style={{ marginTop: idx > 0 ? '4px' : '0' }}>
                            <code 
                              onClick={() => vscode.postMessage({ command: 'openFile', file: conn.file })}
                              style={{ 
                                background: 'var(--vscode-textCodeBlock-background)', 
                                padding: '1px 4px', 
                                borderRadius: '2px',
                                fontSize: '10px',
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                textDecorationColor: 'var(--vscode-textLink-foreground)',
                                color: 'var(--vscode-textLink-foreground)'
                              }}
                              onMouseOver={(e) => {
                                e.currentTarget.style.textDecorationColor = 'var(--vscode-textLink-activeForeground)';
                                e.currentTarget.style.color = 'var(--vscode-textLink-activeForeground)';
                              }}
                              onMouseOut={(e) => {
                                e.currentTarget.style.textDecorationColor = 'var(--vscode-textLink-foreground)';
                                e.currentTarget.style.color = 'var(--vscode-textLink-foreground)';
                              }}
                            >
                              {conn.file}
                            </code>
                            <span style={{ marginLeft: '6px', opacity: 0.8 }}>{conn.error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ 
                    fontSize: '14px', 
                    fontWeight: 400, 
                    color: 'var(--vscode-descriptionForeground)', 
                    marginBottom: '16px' 
                  }}>
                    Connect to Neon branch
                  </div>
                  <div className="section">
                    <label htmlFor="org-app">Organization</label>
                    <select
                      id="org-app"
                      value={state.connection.selectedOrgId || ''}
                      onChange={handleOrgSelection}
                    >
                      <option value="" disabled>Select an organization</option>
                      {filteredOrgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="section">
                    <label htmlFor="project-app">Project</label>
                    <select
                      id="project-app"
                      value={state.connection.selectedProjectId || ""}
                      onChange={handleProjectSelection}
                      disabled={!state.connection.selectedOrgId || state.connection.selectedOrgId === ""}
                    >
                      <option value="" disabled>Select a project</option>
                      {filteredProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="section">
                    <label htmlFor="branch-app">Branch</label>
                    <select
                      id="branch-app"
                      value={state.connection.selectedBranchId || ""}
                      onChange={handleBranchSelection}
                      disabled={!state.connection.selectedProjectId}
                    >
                      <option value="" disabled>Select a branch</option>
                      {filteredBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
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
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}; 


