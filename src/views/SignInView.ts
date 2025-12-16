import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { WebviewMessage } from '../types';
import { AuthManager } from '../auth/authManager';
import { Logger } from '../utils';
import { NeonApiService } from '../services/api.service';
import { getStyles } from '../templates/styles';

export class SignInView {
    private readonly webview: vscode.Webview;
    private readonly stateService: StateService;
    private readonly authManager: AuthManager;
    
    constructor(webview: vscode.Webview, stateService: StateService, authManager: AuthManager) {
        this.webview = webview;
        this.stateService = stateService;
        this.authManager = authManager;
    }

    public getHtml(message?: string, showSignInButton: boolean = true): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Neon - Serverless Postgres - Sign In</title>
                ${getStyles()}
                <style>
                    .message {
                        text-align: center;
                        margin-bottom: 8px;
                    }
                    
                    body {
                        margin: 0;
                        padding: 0;
                        height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .container {
                        padding: 20px;
                        width: 100%;
                    }
                    
                    .button-container {
                        margin-bottom: 16px;
                        display: flex;
                        justify-content: center;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    ${message ? `<div class="message">${message}</div>` : ''}
                    ${showSignInButton ? `
                    <div class="button-container">
                        <button class="button" id="signInButton">Sign in with Neon</button>
                    </div>
                    ` : ''}
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    
                    document.getElementById('signInButton')?.addEventListener('click', () => {
                        vscode.postMessage({ command: 'signIn' });
                    });
                </script>
            </body>
            </html>
        `;
    }

    public async handleSignIn(): Promise<void> {
        try {
            await this.authManager.signIn();
        } catch (error) {
            Logger.error('Sign in failed:', error);
            throw error;
        }
    }

    public handleMessage(message: WebviewMessage): void {
        switch (message.command) {
            case 'showLoading':
                this.webview.html = this.getHtml('Signing in...', false);
                break;
            case 'resetSignIn':
                this.webview.html = this.getHtml();
                break;
            case 'showError':
                this.webview.html = this.getHtml(`Error: ${message.error}`, true);
                break;
        }
    }
} 