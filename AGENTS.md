# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Install dependencies
npm install

# Compile TypeScript (development)
npm run compile

# Watch mode for development
npm run watch

# Production build with minification
npm run package

# Lint the codebase
npm run lint

# Run tests (unit tests + integration tests if env vars set)
npm test

# Compile tests only
npm run compile-tests
```

### Running the Extension

Use VS Code's "Run Extension" launch configuration (F5) which compiles and launches a new Extension Host window with the extension loaded.

### Testing

See [TESTING.md](./TESTING.md) for comprehensive testing documentation including:
- Unit test setup and structure
- Integration tests requiring Neon credentials
- How to obtain API tokens, project IDs, and branch IDs
- Test file locations and conventions

Quick reference:
```bash
# Run all tests (integration tests skip if no credentials)
npm test

# Integration tests require environment variables:
export NEON_API_TOKEN="your_api_token"
export NEON_PROJECT_ID="your_project_id"
export NEON_BRANCH_ID="your_branch_id"
npm test
```

Test files are in `src/test/suite/`:
- `extension.test.ts` - Unit tests (no credentials needed)
- `integration.test.ts` - Integration tests (credentials required)

## Architecture Overview

This is a VS Code extension for Neon Serverless Postgres. The extension ID is `neon-local-connect` and commands are prefixed with `neon-local-connect.` or `neonLocal.`.

### Key Directories

- **`src/extension.ts`** - Main entry point, registers all commands and view providers
- **`src/services/`** - Business logic services (API, schema queries, state management, connection pooling)
- **`src/views/`** - VS Code sidebar view providers (ConnectView, SchemaView, MCPServerView)
- **`src/panels/`** - Webview panels for UI (SQL editor, table data viewer, management panels)
- **`src/auth/`** - OAuth authentication handling with Neon
- **`src/webview/`** - Shared webview components and utilities

### Service Layer

- **`NeonApiService`** (`api.service.ts`) - Neon REST API client for projects, branches, databases, roles
- **`SchemaService`** (`schema.service.ts`) - PostgreSQL schema introspection via `pg` client
- **`StateService`** (`state.service.ts`) - Extension state persistence and view data management
- **`ConnectionPoolService`** (`connectionPool.service.ts`) - PostgreSQL connection pooling per database

### Views and Panels

The extension contributes three sidebar views:
1. **Branch Connection** (`neonLocalConnect`) - Webview for org/project/branch selection
2. **Databases** (`neonLocalSchema`) - Tree view of database schema (only shown when connected)
3. **MCP Server** (`neonLocalMcpServer`) - Webview for AI MCP server configuration

### Build System

Webpack bundles the extension with two configurations:
- Extension bundle (Node.js target) → `dist/extension.js`
- Webview bundles (browser target) for React-based panels

## Authentication System

The extension supports two authentication methods:

### 1. OAuth Flow (Primary)

Uses OpenID Connect with Neon's OAuth server (`oauth2.neon.tech`). The flow is implemented in `src/auth/authService.ts`:

1. **Initial Auth** (`auth()` function):
   - Starts local HTTP server on configurable port (default: auto-assigned)
   - Generates PKCE parameters (state, code_verifier, code_challenge)
   - Opens browser to Neon's authorization URL with scopes: `openid`, `offline`, `offline_access`, plus project/org permissions
   - Waits for callback at `http://127.0.0.1:{port}/callback`
   - Exchanges authorization code for token set (access_token, refresh_token, expires_at)

2. **Token Storage** (via `SecureTokenStorage` in `src/services/secureTokenStorage.ts`):
   - Access token → `context.secrets.store('neon.accessToken')`
   - Refresh token → `context.secrets.store('neon.refreshToken')`
   - Token metadata (expires_at, scope) → `context.globalState` under `neon.tokenSet`

3. **Token Refresh** (`refreshTokenIfNeeded()` in `AuthManager`):
   - Checks `expires_at` with 60-second buffer before expiry
   - Uses `openid-client`'s `client.refresh(tokenSet)` to get new tokens
   - Stores refreshed tokens in both secure storage and globalState
   - On refresh failure (e.g., `invalid_grant`), signs user out

4. **Startup Initialization** (`initializeAuthState()` in `AuthManager`):
   - Migrates tokens from old config-based storage if present
   - Reconstructs tokenSet from secure storage if globalState is empty
   - Attempts silent token refresh if refresh_token exists but no persistent API token
   - Signs user out if refresh fails to avoid stale credentials

### 2. Persistent API Token (Alternative)

Users can import a Neon API token directly instead of using OAuth:
- Stored via `SecureTokenStorage.storePersistentApiToken()`
- Takes precedence over OAuth tokens for API calls
- Auto-created on first OAuth sign-in via `NeonApiService.createApiKey()`

### Token Priority in API Calls

`NeonApiService.getToken()` returns tokens in this order:
1. Persistent API token (if exists)
2. OAuth access token

### Authentication State

- `AuthManager` is a singleton (`getInstance()`)
- Emits `onDidChangeAuthentication` event when auth state changes
- `ready()` returns a Promise that resolves when initialization completes
- `isAuthenticated` getter reflects current auth state

### Key Files

- `src/auth/authManager.ts` - Singleton managing auth state, token refresh, sign-in/out
- `src/auth/authService.ts` - OAuth flow implementation using `openid-client`
- `src/services/secureTokenStorage.ts` - VS Code secrets API wrapper for token storage
- `src/services/api.service.ts` - API client with automatic 401 retry and token refresh
