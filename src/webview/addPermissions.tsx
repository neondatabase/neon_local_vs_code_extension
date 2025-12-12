import React from 'react';
import { createRoot } from 'react-dom/client';
import { AddPermissionsComponent } from './components/panels/PermissionsManagement';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<AddPermissionsComponent />);
}

