import * as vscode from 'vscode';
import { CONFIG } from '../constants';
import type { NeonConfiguration } from '../types';
import { SecureTokenStorage } from '../services/secureTokenStorage';

export class ConfigurationManager {
    private static getConfig(): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration(CONFIG.EXTENSION_NAME);
    }

    static async updateConfig<K extends keyof NeonConfiguration>(
        key: K,
        value: NeonConfiguration[K],
        global = true
    ): Promise<void> {
        const config = this.getConfig();
        await config.update(key, value, global);
    }

    static getConfigValue<K extends keyof NeonConfiguration>(key: K): NeonConfiguration[K] {
        const config = this.getConfig();
        return config.get<NeonConfiguration[K]>(key);
    }

    // Secure token access methods
    static async getSecureToken(context: vscode.ExtensionContext, tokenType: 'apiKey' | 'refreshToken' | 'persistentApiToken'): Promise<string | undefined> {
        const secureStorage = SecureTokenStorage.getInstance(context);
        
        switch (tokenType) {
            case 'apiKey':
                return await secureStorage.getAccessToken();
            case 'refreshToken':
                return await secureStorage.getRefreshToken();
            case 'persistentApiToken':
                return await secureStorage.getPersistentApiToken();
            default:
                return undefined;
        }
    }

    static async updateSecureToken(context: vscode.ExtensionContext, tokenType: 'apiKey' | 'refreshToken' | 'persistentApiToken', value: string | undefined): Promise<void> {
        const secureStorage = SecureTokenStorage.getInstance(context);
        
        switch (tokenType) {
            case 'apiKey':
                if (value) {
                    await secureStorage.storeAccessToken(value);
                } else {
                    await secureStorage.clearAllTokens(); // This will clear all tokens, but for backward compatibility
                }
                break;
            case 'refreshToken':
                if (value) {
                    await secureStorage.storeRefreshToken(value);
                } else {
                    await secureStorage.clearAllTokens(); // This will clear all tokens, but for backward compatibility
                }
                break;
            case 'persistentApiToken':
                if (value) {
                    await secureStorage.storePersistentApiToken(value);
                } else {
                    await secureStorage.clearAllTokens(); // This will clear all tokens, but for backward compatibility
                }
                break;
        }
    }

    static async clearAuth(context: vscode.ExtensionContext): Promise<void> {
        const secureStorage = SecureTokenStorage.getInstance(context);
        await secureStorage.clearAllTokens();
    }
}

export function debounce<T extends (...args: any[]) => void>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;
    
    return function executedFunction(...args: Parameters<T>) {
        if (timeout) {
            clearTimeout(timeout);
        }
        
        timeout = setTimeout(() => {
            func(...args);
        }, wait);
    };
}

export class Logger {
    static error(message: string, error?: unknown): void {
        console.error(message, error);
        if (error instanceof Error) {
            vscode.window.showErrorMessage(`${message}: ${error.message}`);
        } else {
            vscode.window.showErrorMessage(message);
        }
    }

    static info(message: string): void {
        console.debug(message);
        vscode.window.showInformationMessage(message);
    }
}

/**
 * Utility class for getting extension information for tracking purposes.
 * Used to identify extension usage in API calls and database connections.
 */
export class ExtensionInfo {
    private static _version: string | undefined;
    private static _ideName: string | undefined;

    /**
     * Get the extension version from package.json
     */
    static getVersion(): string {
        if (this._version === undefined) {
            try {
                const ext = vscode.extensions.getExtension('databricks.neon-local-connect');
                this._version = ext?.packageJSON?.version || 'unknown';
            } catch {
                this._version = 'unknown';
            }
        }
        return this._version;
    }

    /**
     * Detect if running in Cursor IDE
     */
    static isCursor(): boolean {
        return this.getIdeName() === 'cursor';
    }

    /**
     * Get the IDE name (vscode, cursor, or other)
     * Checks for VS Code first, then Cursor, defaults to "other" for unknown VS Code forks
     */
    static getIdeName(): string {
        if (this._ideName === undefined) {
            const appName = vscode.env.appName.toLowerCase();
            
            // Check for VS Code first (includes "Visual Studio Code" and variants)
            if (appName.includes('visual studio code') || appName === 'code') {
                this._ideName = 'vscode';
            }
            // Check for Cursor
            else if (appName.includes('cursor')) {
                this._ideName = 'cursor';
            }
            // Default to "other" for unknown VS Code forks (e.g., VSCodium, Code - OSS, etc.)
            else {
                this._ideName = 'other';
            }
        }
        return this._ideName;
    }

    /**
     * Get the User-Agent string for API calls
     * Format: neon_extension_{version}_{ide}
     */
    static getUserAgent(): string {
        return `neon_extension_${this.getVersion()}_${this.getIdeName()}`;
    }

    /**
     * Get the application_name for PostgreSQL connections
     * Format: neon_extension_{version}_{ide}
     */
    static getApplicationName(): string {
        return `neon_extension_${this.getVersion()}_${this.getIdeName()}`;
    }
} 