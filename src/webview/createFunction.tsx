import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreateFunctionComponent } from './components/panels/FunctionManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<CreateFunctionComponent />);
}

