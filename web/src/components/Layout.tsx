import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { api } from '../api';
import { getStoredToken } from '../App';

type Props = { onLogout: () => void };

const nav = [
  { to: '/', label: 'Home' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/add', label: 'Add transaction' },
  { to: '/sms', label: 'Add from SMS' },
  { to: '/sheet-merge', label: 'Merge import from sheet' },
  { to: '/charts', label: 'Charts' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/categories', label: 'Categories' },
  { to: '/tags', label: 'Tags' },
  { to: '/setup', label: 'Setup wizard' },
  { to: '/settings', label: 'Settings' },
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
      <nav className="nav">
        <Link to="/" className="nav-title">Mezan</Link>
        <div className="nav-links">
          {nav.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={location.pathname === to ? 'nav-link active' : 'nav-link'}
            >
              {label}
            </Link>
          ))}
          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            Log out
          </button>
        </div>
      </nav>
      <main className={location.pathname === '/' ? 'container container--full' : 'container'}>
        <Outlet />
      </main>
    </div>
  );
}
