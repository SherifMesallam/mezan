import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';

type Props = { onLogout: () => void };

/* Feather-style 24x24 icons (rendered at 22px) */
const icons: Record<string, () => JSX.Element> = {
  home: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  list: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  plus: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  message: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  image: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  merge: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  ),
  barChart: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  wallet: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
    </svg>
  ),
  folder: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  tag: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  zap: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  settings: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  logOut: () => (
    <svg className="layout-sidebar-icon" viewBox="0 0 24 24" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
};

const nav = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/transactions', label: 'Transactions', icon: 'list' },
  { to: '/add', label: 'Add transaction', icon: 'plus' },
  { to: '/sms', label: 'Add from SMS', icon: 'message' },
  { to: '/image', label: 'Scan receipt', icon: 'image' },
  { to: '/sheet-merge', label: 'Merge import from sheet', icon: 'merge' },
  { to: '/charts', label: 'Charts', icon: 'barChart' },
  { to: '/budgets', label: 'Budgets', icon: 'wallet' },
  { to: '/categories', label: 'Categories', icon: 'folder' },
  { to: '/tags', label: 'Tags', icon: 'tag' },
  { to: '/setup', label: 'Setup wizard', icon: 'zap' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export default function Layout({ onLogout }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const token = getStoredToken();
  const [setupChecked, setSetupChecked] = useState(false);

  const allowedDuringSetup = ['/setup', '/budgets', '/categories', '/tags'];

  useEffect(() => {
    if (!token || allowedDuringSetup.includes(location.pathname)) {
      setSetupChecked(true);
      return;
    }
    api<{ setup_completed_at: string | null }>('/v1/setup/status', { token })
      .then((r) => {
        if (r.setup_completed_at == null) {
          navigate('/setup', { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => setSetupChecked(true));
  }, [token, location.pathname, navigate]);

  if (!setupChecked && location.pathname !== '/setup') {
    return <div className="loading">Loading…</div>;
  }

  return (
    <div className="layout">
      <aside className="layout-sidebar">
        <Link to="/" className="layout-sidebar-logo" title="Mezan">
          <span className="layout-sidebar-logo-mark">M</span>
          <span className="layout-sidebar-logo-text">Mezan</span>
        </Link>
        <nav className="layout-sidebar-nav" aria-label="Main">
          {nav.map(({ to, label, icon }) => (
            <Link
              key={to}
              to={to}
              title={label}
              aria-label={label}
              className={`layout-sidebar-link ${location.pathname === to ? 'active' : ''}`}
            >
              {icons[icon]?.()}
            </Link>
          ))}
        </nav>
        <div className="layout-sidebar-footer">
          <button type="button" className="btn btn-secondary" onClick={onLogout} title="Log out" aria-label="Log out">
            {icons.logOut()}
          </button>
        </div>
      </aside>
      <main className="layout-main">
        <div className={location.pathname === '/' ? 'container container--full' : 'container'}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
