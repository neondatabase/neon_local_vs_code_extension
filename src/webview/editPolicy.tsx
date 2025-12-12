import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditPolicyComponent } from './components/panels/PolicyManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<EditPolicyComponent />);
}

