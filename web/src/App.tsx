import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useCallback } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import AddTransaction from './pages/AddTransaction';
import SmsPaste from './pages/SmsPaste';
import Charts from './pages/Charts';
import Budgets from './pages/Budgets';
import Categories from './pages/Categories';
import Tags from './pages/Tags';
import Transactions from './pages/Transactions';
import Settings from './pages/Settings';
import SetupWizard from './pages/SetupWizard';
import MergeFromSheet from './pages/MergeFromSheet';
import AddFromImage from './pages/AddFromImage';

const TOKEN_KEY = 'mezan_token';
const INGEST_TOKEN_KEY = 'mezan_ingest_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getStoredIngestToken(): string | null {
  return localStorage.getItem(INGEST_TOKEN_KEY);
}

export function setStoredIngestToken(token: string | null): void {
  if (token) localStorage.setItem(INGEST_TOKEN_KEY, token);
  else localStorage.removeItem(INGEST_TOKEN_KEY);
}

export default function App() {
  const [token, setToken] = useState<string | null>(getStoredToken);

  const onLogin = useCallback((t: string) => {
    setStoredToken(t);
    setToken(t);
  }, []);

  const onLogout = useCallback(() => {
    setStoredToken(null);
    setStoredIngestToken(null);
    setToken(null);
  }, []);

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login onLogin={onLogin} />} />
      <Route path="/" element={token ? <Layout onLogout={onLogout} /> : <Navigate to="/login" replace />}>
        <Route index element={<Home />} />
        <Route path="add" element={<AddTransaction />} />
        <Route path="sms" element={<SmsPaste />} />
        <Route path="image" element={<AddFromImage />} />
        <Route path="sheet-merge" element={<MergeFromSheet />} />
        <Route path="charts" element={<Charts />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="categories" element={<Categories />} />
        <Route path="tags" element={<Tags />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="setup" element={<SetupWizard />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
