import * as vscode from 'vscode';
import { auth, refreshToken, AuthProps } from './authService';
import { CONFIG } from '../constants';
import { StateService } from '../services/state.service';
import { SecureTokenStorage } from '../services/secureTokenStorage';
import { NeonApiService } from '../services/api.service';

// Use any instead of importing TokenSet to avoid loading openid-client during extension activation
type TokenSet = any;

export class AuthManager {
  private static instance: AuthManager;
  private context: vscode.ExtensionContext;
  private _isAuthenticated: boolean = false;
  private _tokenSet: TokenSet | undefined;
  private _onDidChangeAuthentication = new vscode.EventEmitter<boolean>();
  private secureStorage: SecureTokenStorage;
  private _refreshPromise: Promise<boolean> | null = null;
  private _initializationPromise: Promise<void>;

  readonly onDidChangeAuthentication = this._onDidChangeAuthentication.event;

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.secureStorage = SecureTokenStorage.getInstance(context);
    const rawTokenSet = this.context.globalState.get<TokenSet>('neon.tokenSet');
    
    // Validate and clean the tokenSet from globalState
    if (rawTokenSet && typeof rawTokenSet === 'object') {
      // Ensure we have valid string tokens, not corrupted objects
      const cleanTokenSet: any = {};
      
      if (rawTokenSet.access_token && typeof rawTokenSet.access_token === 'string') {
        cleanTokenSet.access_token = rawTokenSet.access_token;
      }
      
      if (rawTokenSet.refresh_token && typeof rawTokenSet.refresh_token === 'string') {
        cleanTokenSet.refresh_token = rawTokenSet.refresh_token;
      }
      
      // Copy any other properties that might be needed by openid-client
      Object.keys(rawTokenSet).forEach(key => {
        if (key !== 'access_token' && key !== 'refresh_token' && rawTokenSet[key] !== undefined) {
          cleanTokenSet[key] = rawTokenSet[key];
        }
      });
      
      this._tokenSet = Object.keys(cleanTokenSet).length > 0 ? cleanTokenSet : undefined;
    } else {
      this._tokenSet = undefined;
    }
    
    console.debug('AuthManager: Initializing with tokenSet from globalState:', {
      hasRawTokenSet: !!rawTokenSet,
      rawTokenSetType: typeof rawTokenSet,
      rawTokenSetKeys: rawTokenSet ? Object.keys(rawTokenSet) : 'none',
      hasCleanTokenSet: !!this._tokenSet,
      cleanTokenSetKeys: this._tokenSet ? Object.keys(this._tokenSet) : 'none',
      hasAccessToken: !!this._tokenSet?.access_token,
      hasRefreshToken: !!this._tokenSet?.refresh_token,
      accessTokenType: typeof this._tokenSet?.access_token,
      refreshTokenType: typeof this._tokenSet?.refresh_token
    });
    
    // Initialize authentication state - will be updated when tokens are loaded
    this._isAuthenticated = !!this._tokenSet;
    // Begin async initialization and keep a handle so callers can await readiness
    this._initializationPromise = this.initializeAuthState().catch(console.error);
  }

  static getInstance(context: vscode.ExtensionContext): AuthManager {
    if (!AuthManager.instance) {
      AuthManager.instance = new AuthManager(context);
    }
    return AuthManager.instance;
  }

  get isAuthenticated(): boolean {
    return this._isAuthenticated;
  }

  async isAuthenticatedAsync(): Promise<boolean> {
    return this._isAuthenticated;
  }

  get tokenSet(): TokenSet | undefined {
    return this._tokenSet;
  }

  async getPersistentApiToken(): Promise<string | undefined> {
    return await this.secureStorage.getPersistentApiToken();
  }

  async signIn(): Promise<void> {
    try {
      const authProps: AuthProps = {
        oauthHost: 'https://oauth2.neon.tech',
        clientId: 'neonctl',
        extensionUri: this.context.extensionUri
      };

      const tokenSet = await auth(authProps);
      
      this._tokenSet = tokenSet;
      this._isAuthenticated = true;
      
      // Store tokens securely
      await this.context.globalState.update('neon.tokenSet', tokenSet);
      if (tokenSet.access_token) {
        await this.secureStorage.storeAccessToken(tokenSet.access_token);
      }
      if (tokenSet.refresh_token) {
        await this.secureStorage.storeRefreshToken(tokenSet.refresh_token);
      }
      
      this._onDidChangeAuthentication.fire(true);
      
      // Auto-create persistent API key if one doesn't exist
      try {
        console.debug('AuthManager: Checking for existing persistent API token...');
        const existingApiToken = await this.getPersistentApiToken();
        console.debug('AuthManager: Existing API token check result:', !!existingApiToken);
        
        if (!existingApiToken) {
          console.debug('AuthManager: No persistent API token found, creating one automatically...');
          console.debug('AuthManager: Current access token available:', !!this._tokenSet?.access_token);
          
          const apiService = new NeonApiService(this.context);
          const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
          const keyName = `VS Code Extension (${timestamp})`;
          
          console.debug('AuthManager: Calling API to create key with name:', keyName);
          const apiKeyResponse = await apiService.createApiKey(keyName);
          console.debug('AuthManager: API key created, storing it now...');
          
          await this.setPersistentApiToken(apiKeyResponse.key);
          
          console.debug('AuthManager: Persistent API key created and stored successfully');
          vscode.window.showInformationMessage(
            'Successfully signed in to Neon! An API key has been created for this extension.'
          );
        } else {
          console.debug('AuthManager: Persistent API token already exists, skipping creation');
          vscode.window.showInformationMessage('Successfully signed in to Neon!');
        }
      } catch (apiKeyError) {
        // Don't fail the sign-in if API key creation fails
        console.error('AuthManager: Failed to auto-create API key:', apiKeyError);
        console.error('AuthManager: Error details:', JSON.stringify(apiKeyError, null, 2));
        vscode.window.showInformationMessage('Successfully signed in to Neon!');
        // Show a warning but don't block the sign-in
        vscode.window.showWarningMessage(
          'Signed in successfully, but failed to auto-create an API key. You can manually import one if needed.'
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to sign in: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async signOut(): Promise<void> {
    try {
      this._tokenSet = undefined;
      this._isAuthenticated = false;
      
      // Clear stored tokens
      await this.context.globalState.update('neon.tokenSet', undefined);
      await this.secureStorage.clearAllTokens();
      
      this._onDidChangeAuthentication.fire(false);
      
      vscode.window.showInformationMessage('Successfully signed out from Neon!');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to sign out: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  async refreshTokenIfNeeded(force: boolean = false): Promise<boolean> {
    // If a refresh is already in progress, wait for it instead of starting another
    if (this._refreshPromise) {
      console.debug('AuthManager: Awaiting ongoing token refresh');
      return this._refreshPromise;
    }

    // No refresh token → nothing we can do
    if (!this._tokenSet?.refresh_token) {
      console.debug('AuthManager: refreshTokenIfNeeded → no refresh_token – skip refresh');
      return false;
    }

    // If we still have a non-expired access token, skip refreshing to avoid wasting
    // a one-time refresh token.  openid-client exposes `expires_at` in seconds.
    const expiresAtSeconds: number | undefined = this._tokenSet?.expires_at;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const REFRESH_BUFFER = 60; // seconds before expiry we proactively refresh

    if (!force && expiresAtSeconds && expiresAtSeconds - nowSeconds > REFRESH_BUFFER) {
      console.debug('AuthManager: Access token is still valid, skip refresh. Expires in', (expiresAtSeconds - nowSeconds), 'seconds');
      return true; // token still valid and not forced
    }

    try {
      // Mark refresh in progress
      this._refreshPromise = (async () => {
      const authProps: AuthProps = {
        oauthHost: 'https://oauth2.neon.tech',
        clientId: 'neonctl',
        extensionUri: this.context.extensionUri
      };

      console.debug('Attempting to refresh token...');
      const newTokenSet = await refreshToken(authProps, this._tokenSet);
      
      this._tokenSet = newTokenSet;
      
      // Update stored tokens
      await this.context.globalState.update('neon.tokenSet', newTokenSet);
      if (newTokenSet.access_token) {
        await this.secureStorage.storeAccessToken(newTokenSet.access_token);
      }
      if (newTokenSet.refresh_token) {
        await this.secureStorage.storeRefreshToken(newTokenSet.refresh_token);
      }
      
      console.debug('Token refresh successful');
      return true;
      })();
      const result = await this._refreshPromise;
      return result;
    } catch (error) {
      // ensure promise cleared
      this._refreshPromise = null;
      console.error('AuthManager: Token refresh failed (will keep existing tokenSet):', error);

      // If we cannot refresh (e.g. invalid_grant), signal failure to caller so they
      // can transition the user to a signed-out state instead of retrying forever.
      return false;
    } finally {
      // clear promise when done
      this._refreshPromise = null;
    }
  }

  async setPersistentApiToken(token: string): Promise<void> {
    await this.secureStorage.storePersistentApiToken(token);
    
    // Update auth state
    this._isAuthenticated = true;
    this._onDidChangeAuthentication.fire(true);
  }

  async migrateTokensFromConfig(): Promise<void> {
    // Migration logic if needed
  }

  private validateRefreshToken(token: string): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    if (!token) {
      issues.push('Token is empty or null');
      return { isValid: false, issues };
    }
    
    if (typeof token !== 'string') {
      issues.push(`Token is not a string, it's a ${typeof token}`);
      return { isValid: false, issues };
    }
    
    if (token.length < 10) {
      issues.push(`Token is too short: ${token.length} characters`);
    }
    
    if (token.includes('\n') || token.includes('\r')) {
      issues.push('Token contains newline characters');
    }
    
    if (token.includes(' ')) {
      issues.push('Token contains spaces');
    }
    
    if (/[^\w\-._~:/?#[\]@!$&'()*+,;=]/.test(token)) {
      issues.push('Token contains invalid characters for OAuth');
    }
    
    return { isValid: issues.length === 0, issues };
  }

  async initializeAuthState(): Promise<void> {
    console.debug('AuthManager: Starting initializeAuthState...');
    
    // First, migrate any tokens from the old configuration-based storage
    await this.secureStorage.migrateFromConfig();
    
    // Check current token states
    const secureAccessToken = await this.secureStorage.getAccessToken();
    const secureRefreshToken = await this.secureStorage.getRefreshToken();
    const persistentToken = await this.getPersistentApiToken();
    const storedGlobalTokenSet = this.context.globalState.get<any>('neon.tokenSet');
    
    console.debug('AuthManager: DETAILED Token inventory:');
    console.debug('  - Has globalState tokenSet:', !!storedGlobalTokenSet);
    console.debug('  - GlobalState tokenSet keys:', storedGlobalTokenSet ? Object.keys(storedGlobalTokenSet) : 'none');
    console.debug('  - GlobalState access token length:', storedGlobalTokenSet?.access_token?.length || 'none');
    console.debug('  - GlobalState refresh token length:', storedGlobalTokenSet?.refresh_token?.length || 'none');
    console.debug('  - Has secure access token:', !!secureAccessToken);
    console.debug('  - Secure access token length:', secureAccessToken?.length || 'none');
    console.debug('  - Has secure refresh token:', !!secureRefreshToken);
    console.debug('  - Secure refresh token length:', secureRefreshToken?.length || 'none');
    console.debug('  - Has persistent token:', !!persistentToken);
    
    // Log actual token values (first/last 10 chars for security)
    if (secureAccessToken) {
      console.debug('  - Secure access token sample:', secureAccessToken.substring(0, 10) + '...' + secureAccessToken.substring(secureAccessToken.length - 10));
    }
    if (secureRefreshToken) {
      console.debug('  - Secure refresh token sample:', secureRefreshToken.substring(0, 10) + '...' + secureRefreshToken.substring(secureRefreshToken.length - 10));
      
      // Validate the refresh token from secure storage
      const refreshTokenValidation = this.validateRefreshToken(secureRefreshToken);
      console.debug('  - Secure refresh token validation:', refreshTokenValidation);
    }
    if (storedGlobalTokenSet?.access_token) {
      console.debug('  - GlobalState access token sample:', storedGlobalTokenSet.access_token.substring(0, 10) + '...' + storedGlobalTokenSet.access_token.substring(storedGlobalTokenSet.access_token.length - 10));
    }
    if (storedGlobalTokenSet?.refresh_token) {
      console.debug('  - GlobalState refresh token sample:', storedGlobalTokenSet.refresh_token.substring(0, 10) + '...' + storedGlobalTokenSet.refresh_token.substring(storedGlobalTokenSet.refresh_token.length - 10));
      
      // Validate the refresh token from globalState
      const globalRefreshTokenValidation = this.validateRefreshToken(storedGlobalTokenSet.refresh_token);
      console.debug('  - GlobalState refresh token validation:', globalRefreshTokenValidation);
    }
    
    // Compare tokens between storage locations
    if (secureRefreshToken && storedGlobalTokenSet?.refresh_token) {
      const tokensMatch = secureRefreshToken === storedGlobalTokenSet.refresh_token;
      console.debug('  - Refresh tokens match between secure storage and globalState:', tokensMatch);
      if (!tokensMatch) {
        console.debug('  - ⚠️  REFRESH TOKEN MISMATCH DETECTED!');
        console.debug('    - Secure storage length:', secureRefreshToken.length);
        console.debug('    - GlobalState length:', storedGlobalTokenSet.refresh_token.length);
        console.debug('    - First 50 chars secure:', secureRefreshToken.substring(0, 50));
        console.debug('    - First 50 chars global:', storedGlobalTokenSet.refresh_token.substring(0, 50));
      }
    }
    
    // Check if we need to reconstruct the tokenSet from secure storage
    if (!this._tokenSet && (secureAccessToken || secureRefreshToken)) {
      console.debug('AuthManager: Reconstructing tokenSet from secure storage');
      // Create a more complete tokenSet that openid-client expects
      // Try to get additional metadata from the stored tokenSet
      const storedTokenSet = this.context.globalState.get<any>('neon.tokenSet') || {};
      
      this._tokenSet = {
        access_token: secureAccessToken,
        refresh_token: secureRefreshToken,
        token_type: storedTokenSet.token_type || 'Bearer', // Revert to original default with proper case
        // Preserve other properties that might be needed by openid-client
        ...(storedTokenSet.scope && { scope: storedTokenSet.scope }),
        ...(storedTokenSet.expires_in && { expires_in: storedTokenSet.expires_in }),
        ...(storedTokenSet.expires_at && { expires_at: storedTokenSet.expires_at }),
        ...(storedTokenSet.id_token && { id_token: storedTokenSet.id_token }),
        // Note: We don't have expires_in from storage, but refresh should still work
      };
      
      // Only include properties that have values
      if (!secureAccessToken) {
        delete this._tokenSet.access_token;
      }
      if (!secureRefreshToken) {
        delete this._tokenSet.refresh_token;
      }
      
      console.debug('AuthManager: Reconstructed tokenSet structure:');
      console.debug('  - Keys:', Object.keys(this._tokenSet));
      console.debug('  - Token type:', this._tokenSet.token_type);
      console.debug('  - Has access_token:', !!this._tokenSet.access_token);
      console.debug('  - Has refresh_token:', !!this._tokenSet.refresh_token);
      console.debug('  - Access token matches secure storage:', this._tokenSet.access_token === secureAccessToken);
      console.debug('  - Refresh token matches secure storage:', this._tokenSet.refresh_token === secureRefreshToken);
      
      // Store in globalState for consistency
      await this.context.globalState.update('neon.tokenSet', this._tokenSet);
      console.debug('AuthManager: TokenSet reconstructed and saved to globalState');
    } else if (this._tokenSet) {
      console.debug('AuthManager: Using existing tokenSet from constructor');
      console.debug('  - Existing tokenSet keys:', Object.keys(this._tokenSet));
      console.debug('  - Access token length:', this._tokenSet.access_token?.length || 'none');
      console.debug('  - Refresh token length:', this._tokenSet.refresh_token?.length || 'none');
    }
    
    const wasAuthenticated = this._isAuthenticated;
    
    // Persistent token takes precedence over OAuth token
    if (persistentToken) {
      console.debug('AuthManager: Using persistent API token for authentication');
      this._isAuthenticated = true;
    } else if (this._tokenSet?.refresh_token) {
      // If we have a refresh token but no persistent token, attempt silent refresh
      console.debug('AuthManager: Attempting silent token refresh on extension startup...');
      console.debug('AuthManager: Pre-refresh token analysis:');
      console.debug('  - Refresh token type:', typeof this._tokenSet.refresh_token);
      console.debug('  - Refresh token length:', this._tokenSet.refresh_token.length);
      console.debug('  - Refresh token starts with:', this._tokenSet.refresh_token.substring(0, 20));
      console.debug('  - Access token type:', typeof this._tokenSet.access_token);
      console.debug('  - Access token length:', this._tokenSet.access_token?.length || 'none');
      
      try {
        const refreshAttempt = await this.refreshTokenIfNeeded();
        // refreshAttempt may be false if we skipped due to token still valid or missing refresh token
        // maintain existing authenticated state unless we explicitly signed out elsewhere
        if (refreshAttempt) {
          console.debug('AuthManager: Silent token refresh successful');
        } else {
          console.debug('AuthManager: Silent token refresh failed or was not possible – signing user out to avoid stale credentials.');
          // Clear tokens and force the user to authenticate again.
          // We purposely **do not** sign out if a persistent API token exists (handled earlier).
          await this.signOut();
        }
      } catch (error) {
        // Silent refresh failed - log but don't show error to user
        console.debug('AuthManager: Silent token refresh failed during startup:', error);
        this._isAuthenticated = false;
      }
    } else {
      // No tokens available
      console.debug('AuthManager: No tokens available for authentication');
      this._isAuthenticated = false;
    }
    
    console.debug('AuthManager: Final authentication state:', {
      wasAuthenticated,
      isAuthenticated: this._isAuthenticated,
      stateChanged: wasAuthenticated !== this._isAuthenticated
    });
    
    // Fire authentication change event if the state changed
    if (wasAuthenticated !== this._isAuthenticated) {
      this._onDidChangeAuthentication.fire(this._isAuthenticated);
    }
  }

  /**
   * Returns a promise that resolves once the AuthManager has finished evaluating stored
   * credentials (including any silent refresh attempts).  Call this before querying
   * `isAuthenticated` on extension start-up to ensure the value is final.
   */
  public async ready(): Promise<void> {
    await this._initializationPromise;
  }
} 