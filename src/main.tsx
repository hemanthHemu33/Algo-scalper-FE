import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { SettingsProvider } from './lib/settingsContext';
import './styles.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 500,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsProvider>
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    </SettingsProvider>
  </React.StrictMode>
);
