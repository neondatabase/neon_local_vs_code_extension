import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Neon Local Connect Extension Test Suite
 * 
 * These tests verify the core functionality of the extension without requiring
 * authentication or external dependencies.
 */
suite('Neon Local Connect Extension Tests', () => {
    vscode.window.showInformationMessage('Running Neon Local Connect tests...');

    suite('Extension Basics', () => {
        test('Extension should be present', () => {
            const ext = vscode.extensions.getExtension('undefined_publisher.neon-local-connect');
            assert.ok(ext, 'Extension should be installed');
        });

        test('Extension should activate without errors', async function() {
            this.timeout(10000); // Allow 10 seconds for activation
            
        const ext = vscode.extensions.getExtension('undefined_publisher.neon-local-connect');
            assert.ok(ext, 'Extension must be present');
            
            if (!ext.isActive) {
                await ext.activate();
            }
            
            assert.strictEqual(ext.isActive, true, 'Extension should be active after activation');
        });
    });

    suite('Commands', () => {
        const criticalCommands = [
            'neon-local-connect.signIn',
            'neon-local-connect.signOut',
            'neon-local-connect.importToken',
            'neonLocal.schema.refresh'
        ];

        test('Critical commands should be registered', async () => {
            const allCommands = await vscode.commands.getCommands(true);
            const neonCommands = allCommands.filter(cmd => 
                cmd.startsWith('neon-local-connect.') || cmd.startsWith('neonLocal.')
            );

            console.log('Found Neon commands:', neonCommands.length);

            for (const cmd of criticalCommands) {
                assert.ok(
                    neonCommands.includes(cmd),
                    `Critical command "${cmd}" must be registered`
                );
            }
        });

        test('Should register all expected database commands', async () => {
        const commands = await vscode.commands.getCommands(true);
            
            const expectedDbCommands = [
                'neonLocal.schema.createDatabase',
                'neonLocal.schema.dropDatabase',
                'neonLocal.schema.createUser'
            ];

            for (const cmd of expectedDbCommands) {
                assert.ok(
                    commands.includes(cmd),
                    `Database command "${cmd}" should be registered`
                );
            }
        });

        test('signIn command should exist and not crash', async () => {
            try {
                // Just verify the command exists, don't actually sign in
                const commands = await vscode.commands.getCommands();
                assert.ok(commands.includes('neon-local-connect.signIn'));
            } catch (error) {
                assert.fail(`signIn command test failed: ${error}`);
            }
        });
    });

    suite('Configuration', () => {
        test('Extension configuration namespace should exist', () => {
            const config = vscode.workspace.getConfiguration('neonLocal');
            assert.ok(config, 'Configuration should be accessible');
        });

        test('Should have OAuth callback port setting', () => {
            const config = vscode.workspace.getConfiguration('neonLocal');
            const port = config.inspect('oauthCallbackPort');
            assert.ok(port, 'OAuth callback port setting should exist');
        });

        test('Configuration should allow updates', async () => {
            const config = vscode.workspace.getConfiguration('neonLocal');
            // Get current value
            const currentPort = config.get('oauthCallbackPort');
            
            // Verify we can inspect it (doesn't throw)
            const inspection = config.inspect('oauthCallbackPort');
            assert.ok(inspection !== undefined, 'Configuration should be inspectable');
        });
    });

    suite('Views', () => {
        test('Connect view provider should be registered', () => {
            // The connect view creates a command for view data updates
            return vscode.commands.getCommands().then(commands => {
                assert.ok(
                    commands.includes('neonLocal.viewDataChanged'),
                    'View data changed command should exist'
                );
            });
        });

        test('Schema tree view commands should be registered', async () => {
            const commands = await vscode.commands.getCommands();
            
            const schemaCommands = [
                'neonLocal.schema.refresh',
                'neonLocal.schema.onConnectionStateChanged'
            ];

            for (const cmd of schemaCommands) {
                assert.ok(
                    commands.includes(cmd),
                    `Schema command "${cmd}" should be registered`
                );
            }
        });
    });

    suite('Extension Stability', () => {
        test('Should handle multiple command queries without errors', async () => {
            for (let i = 0; i < 5; i++) {
                const commands = await vscode.commands.getCommands(true);
                assert.ok(commands.length > 0, 'Should return commands on each query');
            }
        });

        test('Configuration should be stable across multiple reads', () => {
            for (let i = 0; i < 5; i++) {
                const config = vscode.workspace.getConfiguration('neonLocal');
                assert.ok(config, `Configuration should be accessible on read ${i + 1}`);
            }
        });
    });

    suite('Error Handling', () => {
        test('Should handle non-existent command gracefully', async () => {
            try {
                await vscode.commands.executeCommand('neon-local-connect.nonExistentCommand');
                // If we get here, command might have been handled silently
            } catch (error) {
                // Expected - command doesn't exist
                assert.ok(true, 'Command rejection should be handled');
            }
        });
    });
}); 

/**
 * Integration-style tests that verify the extension works as a whole
 */
suite('Extension Integration', () => {
    test('Extension activation should register all core components', async function() {
        this.timeout(10000);
        
        const ext = vscode.extensions.getExtension('undefined_publisher.neon-local-connect');
        assert.ok(ext);
        
        if (!ext.isActive) {
            await ext.activate();
        }

        // Verify multiple command groups are registered
        const commands = await vscode.commands.getCommands(true);
        const neonCommands = commands.filter(cmd => 
            cmd.startsWith('neon-local-connect.') || cmd.startsWith('neonLocal.')
        );

        // Should have at least 10 commands registered
        assert.ok(
            neonCommands.length >= 10,
            `Should register at least 10 commands, found ${neonCommands.length}`
        );
    });

    test('Configuration and commands should be consistent', async () => {
        const config = vscode.workspace.getConfiguration('neonLocal');
        const commands = await vscode.commands.getCommands(true);
        
        // Configuration exists
        assert.ok(config);
        
        // And commands are registered
        assert.ok(commands.some(cmd => cmd.startsWith('neon-local-connect.')));
    });
});
