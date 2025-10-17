import React, { useState } from 'react';
import { useStateService } from '../context/StateContext';
import { NeonDatabase, NeonRole } from '../../types';

interface DatabaseViewProps {
  vscode: any;
}

export const DatabaseView: React.FC<DatabaseViewProps> = ({ vscode }) => {
  const { state } = useStateService();
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isConfigExpanded, setIsConfigExpanded] = useState<boolean>(false);

  const handleDatabaseChange = (value: string) => {
    vscode.postMessage({
      command: 'selectDatabase',
      database: value
    });
  };

  const handleRoleChange = (value: string) => {
    vscode.postMessage({
      command: 'selectRole',
      role: value
    });
  };

  const handleCopy = async (text: string | undefined, type: string) => {
    try {
      const textToCopy = type === 'connection' ? (state.connectionInfo || '') : (text || '');
      await navigator.clipboard.writeText(textToCopy);
      setCopySuccess(type);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  if (!state.connected) {
    return (
      <div className="not-connected">
        <p>Connect to a database to see its local connection string.</p>
      </div>
    );
  }

  return (
    <div className="connection-details">
      <p className="description">
        Select a database to see its local connection string.
      </p>
      
      <div className="section">
        <label htmlFor="database">Database</label>
        <select
          id="database"
          value={state.selectedDatabase || ''}
          onChange={(e) => handleDatabaseChange(e.target.value)}
        >
          <option value="">Select a database</option>
          {state.databases?.map((db: NeonDatabase) => (
            <option key={db.name} value={db.name}>
              {db.name}
            </option>
          ))}
        </select>
      </div>

      {/* Role dropdown section - temporarily commented out
      <div className="section">
        <label htmlFor="role">Role</label>
        <select
          id="role"
          value={state.selectedRole || ''}
          onChange={(e) => handleRoleChange(e.target.value)}
        >
          <option value="">Select a role</option>
          {state.roles?.map((role: NeonRole) => (
            <option key={role.name} value={role.name}>
              {role.name}
            </option>
          ))}
        </select>
      </div>
      */}

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
              <div className="connection-string">{state.connectionInfo}</div>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="detail-row">
          <div className="detail-label-container">
            <div className="detail-label" title="When connecting to your app using the Neon serverless driver, you need to add these configuration settings to your app's code.">Neon Serverless Driver Config</div>
            <button
              className="copy-button"
              title="Copy serverless driver configuration"
              onClick={() => handleCopy(`import { neonConfig } from '@neondatabase/serverless';\n\n// For http connections\nneonConfig.fetchEndpoint = 'http://localhost:${state.port}/sql';\nneonConfig.poolQueryViaFetch = true;\n\n// For web socket connections\n// neonConfig.wsProxy = () => 'localhost:${state.port}';\n// neonConfig.useSecureWebSocket = false;\n// neonConfig.pipelineConnect = false;\n// neonConfig.poolQueryViaFetch = false;`, 'endpoint')}
            >
              {copySuccess === 'endpoint' ? (
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
            <div className={`connection-string ${!isConfigExpanded ? 'truncated' : ''}`}>
              {!isConfigExpanded ? (
                <>
                  import {'{'} neonConfig {'}'} from '@neondatabase/serverless';<br />
                  neonConfig.fetchEndpoint = 'http://localhost:{state.port}/sql';<br />
                  <span style={{ opacity: 0.6 }}>...</span>
                </>
              ) : (
                <>
                  import {'{'} neonConfig {'}'} from '@neondatabase/serverless';<br /><br />
                  // For http connections<br />
                  neonConfig.fetchEndpoint = 'http://localhost:{state.port}/sql';<br />
                  neonConfig.poolQueryViaFetch = true;<br /><br />
                  // For web socket connections<br />
                  // neonConfig.wsProxy = () =&gt; 'localhost:{state.port}';<br />
                  // neonConfig.useSecureWebSocket = false;<br />
                  // neonConfig.pipelineConnect = false;<br />
                  // neonConfig.poolQueryViaFetch = false;
                </>
              )}
            </div>
            <button
              className="expand-button"
              onClick={() => setIsConfigExpanded(!isConfigExpanded)}
              title={isConfigExpanded ? 'Show less' : 'Show more'}
            >
              {isConfigExpanded ? '▲ Show less' : '▼ Show more'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}; 