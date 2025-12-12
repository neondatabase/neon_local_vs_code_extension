import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditRoleComponent } from './components/panels/UserManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<EditRoleComponent />);
}

