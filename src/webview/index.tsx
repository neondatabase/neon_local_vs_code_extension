import React from 'react';
import { createRoot } from 'react-dom/client';
import { MainApp } from './components/App';
import { StateProvider } from './context/StateContext';
import './styles.css';

// Get VS Code API
declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

// Get root element
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

// Create root
const root = createRoot(rootElement);

// Determine which component to render based on the view type
const viewType = document.body.getAttribute('data-view-type');
let Component;

switch (viewType) {
  case 'neonLocalConnect':
    Component = MainApp;
    break;
  default:
    console.error('Unknown view type:', viewType);
    Component = () => <div>Unknown view type</div>;
}

// Render the app
root.render(
  <React.StrictMode>
    <StateProvider vscode={vscode}>
      <Component vscode={vscode} />
    </StateProvider>
  </React.StrictMode>
); 