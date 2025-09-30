import { EditorView, keymap, highlightSpecialChars, drawSelection, highlightSelectionMatches, dropCursor } from '@codemirror/view';
import { EditorState, Extension } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches as searchHighlight } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { foldGutter, indentOnInput, indentUnit, bracketMatching, foldKeymap } from '@codemirror/language';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { indentWithTab } from '@codemirror/commands';

// Declare global window interface
declare global {
    interface Window {
        EmbeddedSqlEditor: typeof EmbeddedSqlEditor;
    }
}

/**
 * Embedded SQL Editor using CodeMirror 6
 * Provides a native-like editing experience directly in the webview
 */
export class EmbeddedSqlEditor {
    private editor: EditorView;
    private container: HTMLElement;
    private vscode: any;
    private onExecuteCallback?: (query: string) => void;

    constructor(container: HTMLElement, vscode: any) {
        this.container = container;
        this.vscode = vscode;
        this.initializeEditor();
    }

    private initializeEditor(): void {
        // Detect VS Code theme
        const isDark = document.body.classList.contains('vscode-dark');
        
        // SQL keywords and functions for better highlighting
        const sqlKeywords = [
            'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER',
            'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'LIKE', 'BETWEEN', 'IS', 'NULL',
            'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
            'ALTER', 'DROP', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
            'CONSTRAINT', 'UNIQUE', 'CHECK', 'DEFAULT', 'AUTO_INCREMENT',
            'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
            'UNION', 'ALL', 'INTERSECT', 'EXCEPT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
            'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'AS'
        ];

        // Create basic setup extensions manually
        const basicExtensions: Extension[] = [
            highlightSpecialChars(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            autocompletion(),
            highlightSelectionMatches(),
            keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...foldKeymap,
                ...completionKeymap,
            ])
        ];

        // Create editor state with extensions
        const state = EditorState.create({
            doc: '-- Enter your SQL query here\n-- Press Ctrl+Enter to execute\n\n',
            extensions: [
                ...basicExtensions,
                sql({
                    // Enhanced SQL configuration
                    dialect: {
                        keywords: sqlKeywords.join(' ').toLowerCase(),
                        builtin: 'bool boolean bit blob enum long longblob longtext medium mediumblob mediumint mediumtext time timestamp tinyblob tinyint tinytext text bigint int int1 int2 int3 int4 int8 integer float float4 float8 double char varbinary varchar varcharacter precision date datetime year unsigned signed numeric',
                        atoms: 'false true null unknown',
                        operatorChars: '*+\\-<>=&|^!?~',
                        dateSQL: {date: true, time: true, timestamp: true},
                        support: {ODBCdatetime: true, zerolessFloat: true}
                    }
                }),
                isDark ? oneDark : [], // Apply dark theme if VS Code is in dark mode
                keymap.of([
                    indentWithTab,
                    {
                        key: 'Ctrl-Enter',
                        mac: 'Cmd-Enter',
                        run: (view) => {
                            this.executeQuery();
                            return true;
                        }
                    },
                    {
                        key: 'Ctrl-Shift-Enter',
                        mac: 'Cmd-Shift-Enter',
                        run: (view) => {
                            this.executeSelection();
                            return true;
                        }
                    },
                    {
                        key: 'F5',
                        run: (view) => {
                            this.executeQuery();
                            return true;
                        }
                    }
                ]),
                EditorView.theme({
                    '&': {
                        fontSize: '14px',
                        fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Monaco", "Courier New", monospace)'
                    },
                    '.cm-content': {
                        padding: '12px',
                        minHeight: '200px',
                        backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
                        color: isDark ? '#d4d4d4' : '#000000'
                    },
                    '.cm-focused': {
                        outline: 'none'
                    },
                    '.cm-editor': {
                        borderRadius: '4px',
                        border: `1px solid ${isDark ? '#3c3c3c' : '#d1d5da'}`
                    },
                    '.cm-scroller': {
                        fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Monaco", "Courier New", monospace)'
                    },
                    '.cm-line': {
                        padding: '0 4px'
                    },
                    // SQL syntax highlighting colors to match VS Code
                    '.cm-keyword': {
                        color: isDark ? '#569cd6' : '#0000ff',
                        fontWeight: 'bold'
                    },
                    '.cm-string': {
                        color: isDark ? '#ce9178' : '#a31515'
                    },
                    '.cm-comment': {
                        color: isDark ? '#6a9955' : '#008000',
                        fontStyle: 'italic'
                    },
                    '.cm-number': {
                        color: isDark ? '#b5cea8' : '#098658'
                    },
                    '.cm-operator': {
                        color: isDark ? '#d4d4d4' : '#000000'
                    },
                    '.cm-builtin': {
                        color: isDark ? '#4ec9b0' : '#267f99'
                    },
                    '.cm-variable': {
                        color: isDark ? '#9cdcfe' : '#001080'
                    }
                })
            ]
        });

        // Create the editor view
        this.editor = new EditorView({
            state,
            parent: this.container
        });

        // Listen for VS Code theme changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    this.updateTheme();
                }
            });
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    private updateTheme(): void {
        const isDark = document.body.classList.contains('vscode-dark');
        // Recreate editor with new theme
        const currentDoc = this.editor.state.doc.toString();
        this.editor.destroy();
        this.container.innerHTML = '';
        this.initializeEditor();
        this.setValue(currentDoc);
    }

    /**
     * Execute the entire query
     */
    private executeQuery(): void {
        const query = this.getValue().trim();
        if (query && this.onExecuteCallback) {
            this.onExecuteCallback(query);
        } else if (query) {
            // Fallback to VS Code message
            this.vscode.postMessage({
                command: 'executeQuery',
                query: query
            });
        }
    }

    /**
     * Execute only the selected text
     */
    private executeSelection(): void {
        const selection = this.getSelection();
        const query = selection || this.getValue();
        
        if (query.trim() && this.onExecuteCallback) {
            this.onExecuteCallback(query.trim());
        } else if (query.trim()) {
            // Fallback to VS Code message
            this.vscode.postMessage({
                command: 'executeQuery',
                query: query.trim()
            });
        }
    }

    /**
     * Get the current editor content
     */
    public getValue(): string {
        return this.editor.state.doc.toString();
    }

    /**
     * Set the editor content
     */
    public setValue(value: string): void {
        this.editor.dispatch({
            changes: {
                from: 0,
                to: this.editor.state.doc.length,
                insert: value
            }
        });
    }

    /**
     * Get the currently selected text
     */
    public getSelection(): string {
        const state = this.editor.state;
        const selection = state.selection.main;
        if (selection.empty) return '';
        return state.doc.sliceString(selection.from, selection.to);
    }

    /**
     * Insert text at cursor position
     */
    public insertText(text: string): void {
        const state = this.editor.state;
        const selection = state.selection.main;
        this.editor.dispatch({
            changes: {
                from: selection.from,
                to: selection.to,
                insert: text
            },
            selection: {
                anchor: selection.from + text.length
            }
        });
    }

    /**
     * Focus the editor
     */
    public focus(): void {
        this.editor.focus();
    }

    /**
     * Set callback for query execution
     */
    public onExecute(callback: (query: string) => void): void {
        this.onExecuteCallback = callback;
    }

    /**
     * Format the SQL content
     */
    public formatSql(): void {
        const content = this.getValue();
        // Basic SQL formatting
        const formatted = this.basicSqlFormat(content);
        this.setValue(formatted);
    }

    private basicSqlFormat(sql: string): string {
        // Basic SQL formatting logic
        const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'GROUP BY', 'ORDER BY', 'HAVING'];
        let formatted = sql;

        keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            formatted = formatted.replace(regex, `\n${keyword}`);
        });

        return formatted
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
            .trim();
    }

    /**
     * Add SQL templates/snippets
     */
    public insertTemplate(template: string): void {
        const templates: { [key: string]: string } = {
            'select': 'SELECT ${1:*}\nFROM ${2:table_name}\nWHERE ${3:condition};',
            'insert': 'INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values});',
            'update': 'UPDATE ${1:table_name}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};',
            'delete': 'DELETE FROM ${1:table_name}\nWHERE ${2:condition};',
            'join': 'SELECT a.${1:column1}, b.${2:column2}\nFROM ${3:table1} a\nJOIN ${4:table2} b ON a.${5:id} = b.${6:foreign_id};'
        };

        const templateText = templates[template] || template;
        // Simple template insertion (without tab stops for now)
        const cleanTemplate = templateText.replace(/\$\{\d+:([^}]+)\}/g, '$1');
        this.insertText(cleanTemplate);
    }

    /**
     * Destroy the editor
     */
    public destroy(): void {
        if (this.editor) {
            this.editor.destroy();
        }
    }
}

// Export the class globally for use in the webview
if (typeof window !== 'undefined') {
    window.EmbeddedSqlEditor = EmbeddedSqlEditor;
}

// Also export as default for module systems
export default EmbeddedSqlEditor;
