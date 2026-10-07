import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { I18nProvider } from './i18n';
import { AuthProvider } from './auth';
import { UiProvider } from './ui/kit';
import App from './App';

// Apply the saved appearance before the first paint.
try { if (localStorage.getItem('lsp.theme') === 'dark') document.documentElement.classList.add('dark'); } catch { /* ignore */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <UiProvider>
            <App />
          </UiProvider>
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
