import { useState } from 'react';
import { api, type AuthRes } from '../api';

type Props = { onLogin: (token: string) => void };

export default function Login({ onLogin }: Props) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const path = tab === 'signup' ? '/v1/auth/signup' : '/v1/auth/login';
      const res = await api<AuthRes>(path, { method: 'POST', body: { email, password } });
      if (res.token) onLogin(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1 className="page-title">Mezan</h1>
      <p className="page-subtitle">Expense tracker for Egypt/MENA</p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <button
          type="button"
          className={`btn ${tab === 'login' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('login')}
        >
          Log in
        </button>
        <button
          type="button"
          className={`btn ${tab === 'signup' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('signup')}
        >
          Sign up
        </button>
      </div>
      <form onSubmit={submit}>
        <label className="label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem', width: '100%' }} disabled={loading}>
          {loading ? 'Please wait…' : tab === 'login' ? 'Log in' : 'Sign up'}
        </button>
      </form>
    </div>
  );
}
