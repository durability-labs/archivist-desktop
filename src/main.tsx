import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastProvider } from './contexts/ToastContext';
import { DeveloperModeProvider } from './contexts/DeveloperModeContext';
import App from './App';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ToastProvider>
      <DeveloperModeProvider>
        <App />
      </DeveloperModeProvider>
    </ToastProvider>
  </React.StrictMode>
);
