import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreateTriggerComponent } from './components/panels/TriggerManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<CreateTriggerComponent />);
}

