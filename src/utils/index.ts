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