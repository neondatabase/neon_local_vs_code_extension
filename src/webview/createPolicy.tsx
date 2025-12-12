import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreatePolicyComponent } from './components/panels/PolicyManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<CreatePolicyComponent />);
}

