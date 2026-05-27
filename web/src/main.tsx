import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import './styles.css';

// Server-state layer. Sensible defaults for a dashboard: data is fresh for a
// minute, no refetch on window focus (avoids surprise reloads while reviewing).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// Provider nesting: Query (server state) wraps Router (navigation). Pages
// inside the routed tree therefore have both contexts available. The Zustand
// store needs no provider.
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
