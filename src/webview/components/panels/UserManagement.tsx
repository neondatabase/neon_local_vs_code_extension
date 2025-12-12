import React, { useState, useEffect } from 'react';
import { Section, Input, Select, CollapsibleSection, ActionButtons, SqlPreview, useScrollToError } from '../shared';
import { spacing, layouts, componentStyles } from '../../design-system';

// Access vscode from window (acquired in HTML before React loads)
const vscode = (window as any).vscode;

interface UserDefinition {
    roleType?: 'neon' | 'sql';
    username: string;
    password?: string;
    canLogin: boolean;
    isSuperuser: boolean;
    canCreateDb: boolean;
    canCreateRole: boolean;
    connectionLimit: number;
    validUntil?: string;
    memberOf?: string[];
    members?: Array<{ role: string; admin: boolean }>;
}

interface CreateUserProps {
    existingRoles: string[];
}

interface MemberRow {
    id: number;
    role: string;
    admin: boolean;
}

export const CreateUserComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as CreateUserProps;
    
    const [roleType, setRoleType] = useState<'neon' | 'sql'>('neon');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [canLogin, setCanLogin] = useState(true);
    const [canCreateDb, setCanCreateDb] = useState(false);
    const [canCreateRole, setCanCreateRole] = useState(false);
    const [connectionLimit, setConnectionLimit] = useState(-1);
    const [validUntil, setValidUntil] = useState('');
    const [memberOf, setMemberOf] = useState<string[]>([]);
    const [members, setMembers] = useState<MemberRow[]>([]);
    const [memberIdCounter, setMemberIdCounter] = useState(1);
    
    const [error, setError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    setSqlPreview(message.sql);
                    break;
                case 'error':
                    setError(message.error);
                    setIsSubmitting(false);
                    break;
                case 'loading':
                    setIsSubmitting(message.loading);
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    useEffect(() => {
        if (username) {
            const userDef: UserDefinition & { memberOf?: string[] } = {
                roleType,
                username,
                password: canLogin ? password : undefined,
                canLogin,
                isSuperuser: false, // Handled via neon_superuser membership
                canCreateDb,
                canCreateRole,
                connectionLimit,
                validUntil: validUntil || undefined,
                memberOf,
                members: members.map(m => ({ role: m.role, admin: m.admin }))
            };
            vscode.postMessage({ command: 'previewSql', userDef });
        } else {
            setSqlPreview('');
        }
    }, [roleType, username, password, canLogin, canCreateDb, canCreateRole, connectionLimit, validUntil, memberOf, members]);

    const addMember = () => {
        setMembers([...members, { id: memberIdCounter, role: '', admin: false }]);
        setMemberIdCounter(memberIdCounter + 1);
    };

    const removeMember = (id: number) => {
        setMembers(members.filter(m => m.id !== id));
    };

    const updateMember = (id: number, field: 'role' | 'admin', value: string | boolean) => {
        setMembers(members.map(m => 
            m.id === id ? { ...m, [field]: value } : m
        ));
    };

    const toggleMemberOf = (role: string) => {
        if (memberOf.includes(role)) {
            setMemberOf(memberOf.filter(r => r !== role));
        } else {
            setMemberOf([...memberOf, role]);
        }
    };

    const handleSubmit = () => {
        if (!username.trim()) {
            setError('Username is required');
            return;
        }

        // Validate username
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
            setError('Username must start with a letter or underscore and contain only letters, numbers, and underscores');
            return;
        }

        if (canLogin && roleType === 'sql' && !password) {
            setError('Password is required for SQL roles that can login');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const userDef: UserDefinition & { memberOf?: string[] } = {
            roleType,
            username,
            password: canLogin ? password : undefined,
            canLogin,
            isSuperuser: false,
            canCreateDb,
            canCreateRole,
            connectionLimit,
            validUntil: validUntil || undefined,
            memberOf,
            members: members.filter(m => m.role).map(m => ({ role: m.role, admin: m.admin }))
        };

        vscode.postMessage({ command: 'createUser', userDef });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    const roleTypeInfo = roleType === 'neon' 
        ? 'Neon roles are created via API with auto-generated passwords and automatically granted neon_superuser membership (CREATEDB, CREATEROLE, pg_read_all_data, pg_write_all_data, etc.)'
        : 'SQL roles are created with manually specified passwords and privileges';

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Create Role
            </h1>

            {error && (
                <div 
                    ref={errorRef}
                    style={{
                        backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
                        border: '1px solid var(--vscode-inputValidation-errorBorder)',
                        color: 'var(--vscode-inputValidation-errorForeground)',
                        padding: spacing.md,
                        borderRadius: '4px',
                        marginBottom: spacing.lg
                    }}
                >
                    {error}
                </div>
            )}

            <Section title="Basic Information">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Select
                        label="Role Type"
                        value={roleType}
                        onChange={(e) => setRoleType(e.target.value as 'neon' | 'sql')}
                        options={[
                            { value: 'neon', label: 'Neon Role (Admin privileges via neon_superuser)' },
                            { value: 'sql', label: 'SQL Role (Basic privileges, manually configured)' }
                        ]}
                        required
                        helperText={roleTypeInfo}
                    />

                    <Input
                        label="Username/Role Name"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="myuser"
                        helperText="Must be unique and contain only letters, numbers, and underscores"
                        required
                    />

                    {roleType === 'sql' && (
                        <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={canLogin}
                                        onChange={(e) => setCanLogin(e.target.checked)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                    <span style={{ fontSize: '13px', fontWeight: '500' }}>Can Login</span>
                                </label>
                                <div style={{
                                    fontSize: '12px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    fontStyle: 'italic',
                                    marginLeft: '24px'
                                }}>
                                    Allow this user to log in to the database
                                </div>
                            </div>

                            {canLogin && (
                                <>
                                    <div style={{ marginTop: spacing.sm }}>
                                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>
                                            Password <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>
                                        </label>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    padding: '6px 40px 6px 8px',
                                                    backgroundColor: 'var(--vscode-input-background)',
                                                    color: 'var(--vscode-input-foreground)',
                                                    border: '1px solid var(--vscode-input-border)',
                                                    borderRadius: '3px',
                                                    fontSize: '13px',
                                                    outline: 'none'
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                style={{
                                                    position: 'absolute',
                                                    right: '8px',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    background: 'none',
                                                    border: 'none',
                                                    color: 'var(--vscode-input-foreground)',
                                                    cursor: 'pointer',
                                                    padding: '4px',
                                                    opacity: 0.7
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                                                onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                                                title={showPassword ? 'Hide password' : 'Show password'}
                                            >
                                                {showPassword ? '👁️' : '👁️‍🗨️'}
                                            </button>
                                        </div>
                                        <div style={{
                                            fontSize: '12px',
                                            color: 'var(--vscode-descriptionForeground)',
                                            fontStyle: 'italic',
                                            marginTop: '4px'
                                        }}>
                                            Must be 10+ characters with uppercase, lowercase, numbers, and special characters for best results
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </Section>

            {roleType === 'sql' && (
                <CollapsibleSection title="Advanced Settings" defaultExpanded={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    {initialData.existingRoles && initialData.existingRoles.length > 0 && (
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                Role Membership
                            </label>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginBottom: '8px'
                            }}>
                                Make this user a member of existing roles (e.g., neon_superuser for superuser privileges)
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {initialData.existingRoles.map(role => (
                                    <div key={role} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                                        <input
                                            type="checkbox"
                                            id={`role_${role}`}
                                            checked={memberOf.includes(role)}
                                            onChange={() => toggleMemberOf(role)}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <label htmlFor={`role_${role}`} style={{ cursor: 'pointer', margin: 0 }}>
                                            {role}
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                            Members
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginBottom: '8px'
                        }}>
                            Grant membership in this role to other roles/users
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
                            {members.map(member => (
                                <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={member.role}
                                        onChange={(e) => updateMember(member.id, 'role', e.target.value)}
                                        placeholder="Role name"
                                        style={{
                                            flex: 1,
                                            padding: '6px 8px',
                                            backgroundColor: 'var(--vscode-input-background)',
                                            color: 'var(--vscode-input-foreground)',
                                            border: '1px solid var(--vscode-input-border)',
                                            borderRadius: '3px',
                                            fontSize: '13px'
                                        }}
                                    />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <input
                                            type="checkbox"
                                            id={`admin_${member.id}`}
                                            checked={member.admin}
                                            onChange={(e) => updateMember(member.id, 'admin', e.target.checked)}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <label htmlFor={`admin_${member.id}`} style={{ cursor: 'pointer', margin: 0, fontSize: '12px' }}>
                                            Admin
                                        </label>
                                    </div>
                                    <button
                                        onClick={() => removeMember(member.id)}
                                        style={{
                                            backgroundColor: 'var(--vscode-errorForeground)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '3px',
                                            cursor: 'pointer',
                                            fontSize: '16px',
                                            height: '28px',
                                            width: '28px',
                                            padding: 0
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={addMember}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: 'var(--vscode-button-secondaryBackground)',
                                color: 'var(--vscode-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '13px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryHoverBackground)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryBackground)'}
                        >
                            Add Member
                        </button>
                    </div>

                    <div>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>
                            Privileges
                        </h3>

                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: '8px' }}>
                            <input
                                type="checkbox"
                                id="canCreateDb"
                                checked={canCreateDb}
                                onChange={(e) => setCanCreateDb(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <label htmlFor="canCreateDb" style={{ cursor: 'pointer', margin: 0 }}>
                                Can Create Databases
                            </label>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                            <input
                                type="checkbox"
                                id="canCreateRole"
                                checked={canCreateRole}
                                onChange={(e) => setCanCreateRole(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <label htmlFor="canCreateRole" style={{ cursor: 'pointer', margin: 0 }}>
                                Can Create Roles
                            </label>
                        </div>
                    </div>

                    <Input
                        label="Connection Limit"
                        type="number"
                        value={connectionLimit.toString()}
                        onChange={(e) => setConnectionLimit(parseInt(e.target.value) || -1)}
                        helperText="-1 for unlimited, 0 to prevent connections"
                    />

                    <Input
                        label="Valid Until"
                        type="datetime-local"
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        helperText="Expiration date/time for this user"
                    />
                </div>
            </CollapsibleSection>
            )}

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Create Role"
                loading={isSubmitting}
            />
        </div>
    );
};

interface EditRoleProps {
    roleName: string;
    currentRole: {
        can_login: boolean;
        can_create_db: boolean;
        can_create_role: boolean;
        connection_limit: number;
        valid_until?: string;
    };
    currentMemberOf: string[];
    existingRoles: string[];
    currentMembers: Array<{ role: string; admin: boolean }>;
}

export const EditRoleComponent: React.FC = () => {
    const initialData = ((window as any).initialData || {}) as EditRoleProps;
    
    const [roleName, setRoleName] = useState(initialData.roleName || '');
    const [canLogin, setCanLogin] = useState(initialData.currentRole?.can_login || false);
    const [canCreateDb, setCanCreateDb] = useState(initialData.currentRole?.can_create_db || false);
    const [canCreateRole, setCanCreateRole] = useState(initialData.currentRole?.can_create_role || false);
    const [connectionLimit, setConnectionLimit] = useState(initialData.currentRole?.connection_limit || -1);
    const [validUntil, setValidUntil] = useState(() => {
        if (initialData.currentRole?.valid_until) {
            return new Date(initialData.currentRole.valid_until).toISOString().slice(0, 16);
        }
        return '';
    });
    const [memberOf, setMemberOf] = useState<string[]>(initialData.currentMemberOf || []);
    const [members, setMembers] = useState<MemberRow[]>(() => {
        if (initialData.currentMembers) {
            return initialData.currentMembers.map((m, idx) => ({ id: idx + 1, role: m.role, admin: m.admin }));
        }
        return [];
    });
    const [memberIdCounter, setMemberIdCounter] = useState((initialData.currentMembers?.length || 0) + 1);
    
    const [error, setError] = useState('');
    const [sqlPreview, setSqlPreview] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const errorRef = useScrollToError(error);

    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    setSqlPreview(message.sql);
                    break;
                case 'error':
                    setError(message.error);
                    setIsSubmitting(false);
                    break;
                case 'loading':
                    setIsSubmitting(message.loading);
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => window.removeEventListener('message', messageHandler);
    }, []);

    useEffect(() => {
        const changes: any = {
            originalName: initialData.roleName,
            roleName,
            canLogin,
            canCreateDb,
            canCreateRole,
            connectionLimit,
            validUntil: validUntil || undefined,
            memberOf,
            members: members.filter(m => m.role).map(m => ({ role: m.role, admin: m.admin }))
        };
        vscode.postMessage({ command: 'previewEditSql', changes });
    }, [roleName, canLogin, canCreateDb, canCreateRole, connectionLimit, validUntil, memberOf, members]);

    const addMember = () => {
        setMembers([...members, { id: memberIdCounter, role: '', admin: false }]);
        setMemberIdCounter(memberIdCounter + 1);
    };

    const removeMember = (id: number) => {
        setMembers(members.filter(m => m.id !== id));
    };

    const updateMember = (id: number, field: 'role' | 'admin', value: string | boolean) => {
        setMembers(members.map(m => 
            m.id === id ? { ...m, [field]: value } : m
        ));
    };

    const toggleMemberOf = (role: string) => {
        if (memberOf.includes(role)) {
            setMemberOf(memberOf.filter(r => r !== role));
        } else {
            setMemberOf([...memberOf, role]);
        }
    };

    const handleSubmit = () => {
        if (!roleName.trim()) {
            setError('Role name is required');
            return;
        }

        // Validate role name
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(roleName)) {
            setError('Role name must start with a letter or underscore and contain only letters, numbers, and underscores');
            return;
        }

        setError('');
        setIsSubmitting(true);

        const changes = {
            originalName: initialData.roleName,
            roleName,
            canLogin,
            canCreateDb,
            canCreateRole,
            connectionLimit,
            validUntil: validUntil || undefined,
            memberOf,
            members: members.filter(m => m.role).map(m => ({ role: m.role, admin: m.admin }))
        };

        vscode.postMessage({ command: 'editRole', changes });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    return (
        <div style={{ ...layouts.container, maxWidth: '600px', margin: '0 auto', padding: spacing.lg }}>
            <h1 style={componentStyles.panelTitle}>
                Edit Role: {initialData.roleName}
            </h1>

            {error && (
                <div 
                    ref={errorRef}
                    style={{
                        backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
                        border: '1px solid var(--vscode-inputValidation-errorBorder)',
                        color: 'var(--vscode-inputValidation-errorForeground)',
                        padding: spacing.md,
                        borderRadius: '4px',
                        marginBottom: spacing.lg
                    }}
                >
                    {error}
                </div>
            )}

            <Section title="Basic Information">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Input
                        label="Role Name"
                        value={roleName}
                        onChange={(e) => setRoleName(e.target.value)}
                        helperText="Must start with a letter and contain only letters, numbers, and underscores"
                        required
                    />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={canLogin}
                                onChange={(e) => setCanLogin(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: '13px', fontWeight: '500' }}>Can Login</span>
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginLeft: '24px'
                        }}>
                            Allow this user to log in to the database
                        </div>
                    </div>
                </div>
            </Section>

            <CollapsibleSection title="Advanced Settings" defaultExpanded={false}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    {initialData.existingRoles && initialData.existingRoles.length > 0 && (
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                                Role Membership
                            </label>
                            <div style={{
                                fontSize: '12px',
                                color: 'var(--vscode-descriptionForeground)',
                                fontStyle: 'italic',
                                marginBottom: '8px'
                            }}>
                                Make this user a member of existing roles (e.g., neon_superuser for superuser privileges)
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {initialData.existingRoles.map(role => (
                                    <div key={role} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                                        <input
                                            type="checkbox"
                                            id={`role_${role}`}
                                            checked={memberOf.includes(role)}
                                            onChange={() => toggleMemberOf(role)}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <label htmlFor={`role_${role}`} style={{ cursor: 'pointer', margin: 0 }}>
                                            {role}
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                            Members
                        </label>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--vscode-descriptionForeground)',
                            fontStyle: 'italic',
                            marginBottom: '8px'
                        }}>
                            Grant membership in this role to other roles/users
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
                            {members.map(member => (
                                <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <input
                                        type="text"
                                        value={member.role}
                                        onChange={(e) => updateMember(member.id, 'role', e.target.value)}
                                        placeholder="Role name"
                                        style={{
                                            flex: 1,
                                            padding: '6px 8px',
                                            backgroundColor: 'var(--vscode-input-background)',
                                            color: 'var(--vscode-input-foreground)',
                                            border: '1px solid var(--vscode-input-border)',
                                            borderRadius: '3px',
                                            fontSize: '13px'
                                        }}
                                    />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <input
                                            type="checkbox"
                                            id={`admin_${member.id}`}
                                            checked={member.admin}
                                            onChange={(e) => updateMember(member.id, 'admin', e.target.checked)}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <label htmlFor={`admin_${member.id}`} style={{ cursor: 'pointer', margin: 0, fontSize: '12px' }}>
                                            Admin
                                        </label>
                                    </div>
                                    <button
                                        onClick={() => removeMember(member.id)}
                                        style={{
                                            backgroundColor: 'var(--vscode-errorForeground)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '3px',
                                            cursor: 'pointer',
                                            fontSize: '16px',
                                            height: '28px',
                                            width: '28px',
                                            padding: 0
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={addMember}
                            style={{
                                padding: '6px 12px',
                                backgroundColor: 'var(--vscode-button-secondaryBackground)',
                                color: 'var(--vscode-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '13px'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryHoverBackground)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--vscode-button-secondaryBackground)'}
                        >
                            Add Member
                        </button>
                    </div>

                    <div>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600' }}>
                            Privileges
                        </h3>

                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: '8px' }}>
                            <input
                                type="checkbox"
                                id="canCreateDb"
                                checked={canCreateDb}
                                onChange={(e) => setCanCreateDb(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <label htmlFor="canCreateDb" style={{ cursor: 'pointer', margin: 0 }}>
                                Can Create Databases
                            </label>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                            <input
                                type="checkbox"
                                id="canCreateRole"
                                checked={canCreateRole}
                                onChange={(e) => setCanCreateRole(e.target.checked)}
                                style={{ cursor: 'pointer' }}
                            />
                            <label htmlFor="canCreateRole" style={{ cursor: 'pointer', margin: 0 }}>
                                Can Create Roles
                            </label>
                        </div>
                    </div>

                    <Input
                        label="Connection Limit"
                        type="number"
                        value={connectionLimit.toString()}
                        onChange={(e) => setConnectionLimit(parseInt(e.target.value) || -1)}
                        helperText="-1 for unlimited, 0 to prevent connections"
                    />

                    <Input
                        label="Valid Until"
                        type="datetime-local"
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        helperText="Expiration date/time for this user"
                    />
                </div>
            </CollapsibleSection>

            {sqlPreview && (
                <SqlPreview sql={sqlPreview} />
            )}

            <ActionButtons
                onSave={handleSubmit}
                onCancel={handleCancel}
                saveLabel="Update Role"
                loading={isSubmitting}
            />
        </div>
    );
};

