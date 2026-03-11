import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { api } from '../api';
import { getStoredToken } from '../App';

type SummaryItem = { key: string; total: number };

const COLORS = ['#0d7377', '#14a3a8', '#32b8bc', '#5cc5c9', '#7dd3d6', '#9ee0e2', '#c2ebed', '#e0f5f6'];

function useKeyToName(token: string | null, groupBy: string) {
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!token || (groupBy !== 'category' && groupBy !== 'tag')) {
      setMap({});
      return;
    }
    const path = groupBy === 'category' ? '/v1/categories' : '/v1/tags';
    const key = groupBy === 'category' ? 'categories' : 'tags';
    api<{ [k: string]: { id: string; name: string }[] }>(path, { token })
      .then((r) => {
        const arr = r[key] || [];
        setMap(Object.fromEntries(arr.map((x) => [x.id, x.name])));
      })
      .catch(() => setMap({}));
  }, [token, groupBy]);
  return map;
}

export default function Charts() {
  const token = getStoredToken();
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [groupBy, setGroupBy] = useState<'category' | 'tag' | 'day'>('category');
  const [loading, setLoading] = useState(true);
  const keyToName = useKeyToName(token, groupBy);

  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api<{ summary: SummaryItem[] }>('/v1/insights/summary', {
      token,
      query: { from, to, group_by: groupBy },
    })
      .then((r) => setSummary(r.summary || []))
      .finally(() => setLoading(false));
  }, [token, groupBy, from, to]);

  const label = (key: string) => {
    if (groupBy === 'day') return key;
    if (key === '_untagged') return 'Untagged';
    return keyToName[key] || key;
  };

  if (loading) return <div className="loading">Loading…</div>;

  const total = summary.reduce((s, x) => s + x.total, 0);
  const pieData = summary.map((s, i) => ({
    name: label(s.key) || s.key,
    value: s.total,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <>
      <h1 className="page-title">Charts</h1>
      <p className="page-subtitle">Spending by {groupBy}</p>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <label className="label">Group by</label>
        <select
          className="input"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as 'category' | 'tag' | 'day')}
        >
          <option value="category">Category</option>
          <option value="tag">Tag</option>
          <option value="day">Day</option>
        </select>
      </div>
      {summary.length === 0 ? (
        <div className="card"><p style={{ margin: 0, color: '#666' }}>No data for this period.</p></div>
      ) : (
        <>
          <div className="card" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={pieData[i].color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `EGP ${v.toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="list" style={{ marginTop: '1rem' }}>
            {summary.map((s, i) => (
              <li key={s.key} className="list-item">
                <span className="list-item-main">
                  <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length], marginRight: 8 }} />
                  {label(s.key) || s.key}
                </span>
                <span className="list-item-amount">
                  EGP {s.total.toFixed(2)}
                  {total > 0 && ` (${((s.total / total) * 100).toFixed(0)}%)`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
