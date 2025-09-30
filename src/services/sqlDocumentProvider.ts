import * as vscode from 'vscode';
import { StateService } from './state.service';
import { SqlQueryService } from './sqlQuery.service';

/**
 * SQL Document Provider that creates virtual SQL files that open in VS Code's native editor
 * This gives users the full VS Code editing experience with syntax highlighting, IntelliSense, etc.
 */
export class SqlDocumentProvider implements vscode.TextDocumentContentProvider {
    private static readonly scheme = 'neon-sql';
    private documents = new Map<string, string>();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    
    constructor(
        private stateService: StateService,
        private context: vscode.ExtensionContext
    ) {}

    static register(stateService: StateService, context: vscode.ExtensionContext): SqlDocumentProvider {
        const provider = new SqlDocumentProvider(stateService, context);
        
        // Register the document provider
        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider(SqlDocumentProvider.scheme, provider)
        );

        // Register commands for SQL operations
        context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.openSqlEditor', () => {
                provider.openSqlEditor();
            }),
            
            vscode.commands.registerCommand('neonLocal.executeSqlQuery', () => {
                provider.executeCurrentQuery();
            }),

            vscode.commands.registerCommand('neonLocal.executeSqlSelection', () => {
                provider.executeSelection();
            })
        );

        // Register language configuration for better SQL editing experience
        provider.configureSqlLanguage();

        return provider;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    /**
     * Provide content for virtual SQL documents
     */
    provideTextDocumentContent(uri: vscode.Uri): string {
        const content = this.documents.get(uri.toString());
        return content || '-- Enter your SQL query here\n-- Press Ctrl+Shift+E to execute\n\n';
    }

    /**
     * Open a new SQL editor with VS Code's native editor
     */
    async openSqlEditor(initialQuery?: string, database?: string): Promise<vscode.TextEditor> {
        const timestamp = Date.now();
        const fileName = database ? `${database}-query-${timestamp}.sql` : `query-${timestamp}.sql`;
        const uri = vscode.Uri.parse(`${SqlDocumentProvider.scheme}:${fileName}`);
        
        // Store initial content
        this.documents.set(uri.toString(), initialQuery || '-- Enter your SQL query here\n-- Press Ctrl+Shift+E to execute\n\n');
        
        // Open the document in VS Code's editor
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.One
        });

        // Set language mode to SQL for syntax highlighting
        await vscode.languages.setTextDocumentLanguage(document, 'sql');

        // Add database context to status bar
        if (database) {
            vscode.window.setStatusBarMessage(`🗄️ Connected to: ${database}`, 5000);
        }

        return editor;
    }

    /**
     * Execute the current query in the active SQL editor
     */
    async executeCurrentQuery(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.isSqlDocument(editor.document)) {
            vscode.window.showWarningMessage('Please open a SQL file or use the Neon SQL Editor');
            return;
        }

        const query = editor.document.getText().trim();
        if (!query) {
            vscode.window.showWarningMessage('Please enter a SQL query');
            return;
        }

        await this.executeQuery(query, editor);
    }

    /**
     * Execute the selected text as a SQL query
     */
    async executeSelection(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this.isSqlDocument(editor.document)) {
            vscode.window.showWarningMessage('Please open a SQL file or use the Neon SQL Editor');
            return;
        }

        const selection = editor.selection;
        const query = editor.document.getText(selection).trim();
        
        if (!query) {
            vscode.window.showWarningMessage('Please select a SQL query to execute');
            return;
        }

        await this.executeQuery(query, editor);
    }

    /**
     * Execute a SQL query and show results
     */
    private async executeQuery(query: string, editor: vscode.TextEditor): Promise<void> {
        const sqlService = new SqlQueryService(this.stateService, this.context);
        
        try {
            // Show progress
            const progress = vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Executing SQL Query...',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0 });
                
                const result = await sqlService.executeQuery(query);
                
                progress.report({ increment: 100 });
                return result;
            });

            const result = await progress;
            
            // Show results in output channel or webview
            await this.showQueryResults(result, query);
            
        } catch (error: any) {
            vscode.window.showErrorMessage(`SQL Error: ${error.message}`);
            
            // Highlight error line if possible
            if (error.line) {
                const line = Math.max(0, error.line - 1);
                const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);
                editor.selection = new vscode.Selection(range.start, range.end);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
        }
    }

    /**
     * Show query results in a dedicated output channel or webview
     */
    private async showQueryResults(result: any, query: string): Promise<void> {
        // Option 1: Show in output channel (simple)
        const outputChannel = vscode.window.createOutputChannel('Neon SQL Results');
        outputChannel.clear();
        outputChannel.appendLine(`Query: ${query}`);
        outputChannel.appendLine('');
        outputChannel.appendLine(`Execution Time: ${result.executionTime}ms`);
        outputChannel.appendLine(`Rows Affected: ${result.rowCount || 0}`);
        outputChannel.appendLine('');
        
        if (result.rows && result.rows.length > 0) {
            // Format as table
            const columns = Object.keys(result.rows[0]);
            outputChannel.appendLine(columns.join('\t'));
            outputChannel.appendLine('-'.repeat(columns.join('\t').length));
            
            result.rows.forEach((row: any) => {
                const values = columns.map(col => String(row[col] || ''));
                outputChannel.appendLine(values.join('\t'));
            });
        }
        
        outputChannel.show(true);

        // Option 2: Open results in webview (more advanced)
        // You could also open your existing SQL query panel with results
        vscode.commands.executeCommand('neon-local-connect.openSqlQueryPanel', query, result);
    }

    /**
     * Check if document is a SQL document (either .sql file or our virtual document)
     */
    private isSqlDocument(document: vscode.TextDocument): boolean {
        return document.languageId === 'sql' || 
               document.uri.scheme === SqlDocumentProvider.scheme ||
               document.fileName.endsWith('.sql');
    }

    /**
     * Configure SQL language support
     */
    private configureSqlLanguage(): void {
        // Register SQL language configuration for better editing experience
        vscode.languages.setLanguageConfiguration('sql', {
            comments: {
                lineComment: '--',
                blockComment: ['/*', '*/']
            },
            brackets: [
                ['{', '}'],
                ['[', ']'],
                ['(', ')']
            ],
            autoClosingPairs: [
                { open: '{', close: '}' },
                { open: '[', close: ']' },
                { open: '(', close: ')' },
                { open: '"', close: '"', notIn: ['string'] },
                { open: "'", close: "'", notIn: ['string', 'comment'] }
            ],
            surroundingPairs: [
                { open: '{', close: '}' },
                { open: '[', close: ']' },
                { open: '(', close: ')' },
                { open: '"', close: '"' },
                { open: "'", close: "'" }
            ]
        });

        // Add SQL snippets
        const sqlSnippets = vscode.languages.registerCompletionItemProvider('sql', {
            provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
                const snippets: vscode.CompletionItem[] = [
                    {
                        label: 'SELECT',
                        kind: vscode.CompletionItemKind.Snippet,
                        insertText: new vscode.SnippetString('SELECT ${1:*} FROM ${2:table_name} WHERE ${3:condition};'),
                        documentation: 'SELECT statement template'
                    },
                    {
                        label: 'INSERT',
                        kind: vscode.CompletionItemKind.Snippet,
                        insertText: new vscode.SnippetString('INSERT INTO ${1:table_name} (${2:columns}) VALUES (${3:values});'),
                        documentation: 'INSERT statement template'
                    },
                    {
                        label: 'UPDATE',
                        kind: vscode.CompletionItemKind.Snippet,
                        insertText: new vscode.SnippetString('UPDATE ${1:table_name} SET ${2:column} = ${3:value} WHERE ${4:condition};'),
                        documentation: 'UPDATE statement template'
                    },
                    {
                        label: 'DELETE',
                        kind: vscode.CompletionItemKind.Snippet,
                        insertText: new vscode.SnippetString('DELETE FROM ${1:table_name} WHERE ${2:condition};'),
                        documentation: 'DELETE statement template'
                    }
                ];
                
                return snippets;
            }
        });

        this.context.subscriptions.push(sqlSnippets);
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
