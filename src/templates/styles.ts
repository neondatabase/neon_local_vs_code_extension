export const getStyles = (): string => `
<style>
    body {
        padding: 20px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-editor-foreground);
        line-height: 1.25;
    }
    .header {
        display: flex;
        align-items: center;
        margin-bottom: 20px;
    }
    .neon-logo {
        margin-right: 10px;
    }
    h1 {
        margin: 24px 0 32px 0;
        font-size: 20px;
        font-weight: 600;
    }
    select {
        width: 100%;
        padding: 8px;
        padding-right: 32px;
        margin: 4px 0 8px 0;
        background-color: var(--vscode-dropdown-background);
        color: var(--vscode-dropdown-foreground);
        border: 1px solid var(--vscode-dropdown-border);
        border-radius: 4px;
        font-size: 12px;
        transition: border-color 0.2s, opacity 0.2s;
        appearance: none;
        background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z' fill='%23C5C5C5'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
    }
    select:focus, button:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }
    select:hover:not(:disabled) {
        border-color: var(--vscode-dropdown-listBackground);
    }
    button {
        padding: 8px 24px;
        margin: 4px 0 8px 0;
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        font-weight: 500;
        text-align: center;
        transition: background-color 0.2s;
    }
    button:hover:not(:disabled) {
        background-color: var(--vscode-button-hoverBackground);
    }
    button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .section {
        margin-bottom: 8px;
    }
    .section label {
        display: block;
        margin-bottom: 0px;
        color: var(--vscode-foreground);
        font-size: 12px;
        font-weight: 500;
    }
    .proxy-buttons {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 20px;
    }
    .proxy-buttons button {
        margin: 0;
    }
    .connection-details {
        padding: 0;
        margin-top: 8px;
    }
    .detail-row {
        display: flex;
        flex-direction: column;
        padding: 8px 0;
        gap: 2px;
    }
    .detail-row:last-child {
        padding-bottom: 0;
    }
    .detail-label {
        color: var(--vscode-descriptionForeground);
        font-size: 10px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .detail-value {
        color: var(--vscode-foreground);
        font-size: 12px;
        font-weight: normal;
    }
    .connection-status {
        margin: 0;
        padding: 0;
    }
    .status-indicator {
        display: flex;
        align-items: center;
        font-size: 13px;
        font-weight: 500;
    }
    .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 8px;
    }
    .status-indicator.connected {
        color: var(--vscode-testing-iconPassed, #73C991);
    }
    .status-indicator.connected .status-dot {
        background-color: var(--vscode-testing-iconPassed, #73C991);
        box-shadow: 0 0 4px var(--vscode-testing-iconPassed, #73C991);
    }
    .status-indicator.disconnected {
        color: var(--vscode-testing-iconQueued, #919191);
    }
    .status-indicator.disconnected .status-dot {
        background-color: var(--vscode-testing-iconQueued, #919191);
    }
    .connection-string-container {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--vscode-editor-font-family);
        width: 100%;
    }
    .connection-string {
        flex: 1;
        font-size: 12px;
        word-break: break-all;
        color: var(--vscode-foreground);
    }
    .copy-button {
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: transparent;
        color: var(--vscode-icon-foreground);
        padding: 4px;
        font-size: 12px;
        border-radius: 3px;
        margin: 0;
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        border: none;
        cursor: pointer;
        opacity: 0.5;
        position: relative;
    }
    .copy-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
        opacity: 1;
    }
    .copy-success {
        position: absolute;
        color: var(--vscode-notificationsSuccessIcon-foreground, #89D185);
        font-size: 10px;
        left: calc(100% + 4px);
        top: 50%;
        transform: translateY(-50%);
        white-space: nowrap;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
    }
    .copy-success.visible {
        opacity: 1;
    }
    .form-description {
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        margin-bottom: 16px;
    }
    .detail-label-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        flex-direction: row;
        margin-bottom: 0;
    }
    .spinner {
        display: none;
        width: 24px;
        height: 24px;
        margin: 20px auto;
        border: 3px solid var(--vscode-button-background);
        border-top: 3px solid var(--vscode-button-hoverBackground);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    .stop-button, .reset-button, .sql-editor-button, .psql-button {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
    }
    .stop-button:hover, .reset-button:hover, .sql-editor-button:hover, .psql-button:hover {
        background-color: var(--vscode-button-hoverBackground);
    }
    .actions-container {
        padding: 0;
    }
    .action-group {
        display: flex;
        flex-direction: column;
        gap: 0px;
    }
    .action-button {
        width: 100%;
        padding: 8px 12px;
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.2s;
    }
    .action-button:hover:not(:disabled) {
        background-color: var(--vscode-button-hoverBackground);
    }
    .action-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .status-message {
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        text-align: center;
        padding: 16px;
    }

    .description {
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        margin: 0 0 16px 0;
        line-height: 1.4;
    }

    /* Form Styles */
    .container {
        max-width: 600px;
        margin: 0 auto;
    }
    
    .section-box {
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 4px;
        padding: 16px;
        margin-bottom: 16px;
    }
    
    .form-group {
        margin-bottom: 16px;
    }
    
    .form-group:last-child {
        margin-bottom: 0;
    }
    
    .form-group label {
        display: block;
        margin-bottom: 4px;
        font-weight: 500;
        font-size: 12px;
        color: var(--vscode-foreground);
    }
    
    input[type="text"],
    input[type="number"],
    input[type="password"],
    textarea {
        width: 100%;
        background-color: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 8px;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        box-sizing: border-box;
    }
    
    input:focus,
    select:focus,
    textarea:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
    }
    
    input:disabled,
    select:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    
    .info-text {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        margin-top: 4px;
        line-height: 1.4;
    }
    
    .error {
        color: var(--vscode-errorForeground);
        background-color: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        padding: 12px;
        border-radius: 4px;
        margin-bottom: 16px;
        font-size: 12px;
    }
    
    .actions {
        display: flex;
        gap: 8px;
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--vscode-panel-border);
    }
    
    .btn {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 8px 24px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        margin: 0;
    }
    
    .btn:hover:not(:disabled) {
        background-color: var(--vscode-button-hoverBackground);
    }
    
    .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    
    .btn-secondary {
        background-color: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
    }
    
    .btn-secondary:hover:not(:disabled) {
        background-color: var(--vscode-button-secondaryHoverBackground);
    }
    
    .sql-preview {
        background-color: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 12px;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px;
        white-space: pre-wrap;
        max-height: 300px;
        overflow: auto;
        margin-top: 12px;
        color: var(--vscode-editor-foreground);
    }
    
    /* Collapsible Sections */
    .collapsible-header {
        cursor: pointer;
        user-select: none;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--vscode-foreground);
        padding: 0;
        margin-bottom: 0;
    }
    
    .collapsible-header:hover {
        opacity: 0.8;
    }
    
    .toggle-icon {
        display: inline-block;
        transition: transform 0.2s ease;
        font-size: 10px;
        color: var(--vscode-foreground);
    }
    
    .collapsible-content {
        display: none;
        padding-top: 12px;
    }
    
    .section.collapsible .section-title {
        margin-bottom: 0;
    }
    
    .section-box.collapsible .collapsible-content {
        margin-top: 12px;
    }
    
    .required {
        color: var(--vscode-errorForeground);
    }
    
    /* Checkbox Group */
    .checkbox-group {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }
    
    .checkbox-group input[type="checkbox"] {
        width: auto;
        margin: 0;
    }
    
    .checkbox-group label {
        margin: 0;
        font-size: 12px;
        cursor: pointer;
    }
</style>
`; 