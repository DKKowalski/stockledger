import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import { StockLedgerToaster } from './components/ui/stockledger-toaster';
import { UiProvider } from './components/ui/ui-provider';
import 'sonner/dist/styles.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter><AuthProvider><UiProvider><App /><StockLedgerToaster /></UiProvider></AuthProvider></BrowserRouter>
  </StrictMode>,
);
