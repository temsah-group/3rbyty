import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import './index.css';
// The install offer is caught from the very first moment.
import '@/lib/install';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Don't retry what the server refused on purpose.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

// The worker that shows push notifications also makes the site installable.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/push-sw.js').catch(() => {}));
}

// A push arrived while the site is open: the unread count and inbox catch up.
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
  if (event.data?.type !== 'push') return;
  void queryClient.invalidateQueries({ queryKey: ['me', 'unread'] });
  void queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
