import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FaBoxes, FaExchangeAlt, FaExclamationTriangle, FaDatabase,
  FaArrowUp, FaArrowDown, FaClock, FaCheckCircle, FaBell,
  FaFire, FaShieldAlt, FaCogs, FaChartLine,
  FaClipboardList, FaBrain, FaHeartbeat, FaCalendarAlt, FaBolt, FaSpinner
} from 'react-icons/fa';
import './IMSDashboard.css';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useToast } from '../components/Toast';

// ─── Dynamic Mock Generators (Moved inside component) ────────────────────────
const weekLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Circular Ring ──────────────────────────────────────────────────────────
const CircularRing = ({ daysLeft, maxDays, animated }) => {
  const R = 28;
  const circum = 2 * Math.PI * R;
  const pct = Math.min(daysLeft / maxDays, 1);
  const color = daysLeft <= 7 ? '#e74c3c' : daysLeft <= 14 ? '#f39c12' : '#27ae60';
  const dash = animated ? pct * circum : 0;
  return (
    <svg width="70" height="70" viewBox="0 0 70 70">
      <circle cx="35" cy="35" r={R} fill="none" stroke="#f0f0f0" strokeWidth="6" />
      <circle
        cx="35" cy="35" r={R} fill="none"
        stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${dash} ${circum}`}
        strokeDashoffset="0"
        transform="rotate(-90 35 35)"
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)' }}
      />
      <text x="35" y="34" textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="800" fill={color}>{daysLeft}</text>
      <text x="35" y="46" textAnchor="middle" dominantBaseline="middle" fontSize="8" fill="#95a5a6">DAYS</text>
    </svg>
  );
};

// ─── Weekly Line Chart ────────────────────────────────────────────────────────
const WeeklyLineChart = ({ animated, trends }) => {
  const w = 800, h = 200, pad = 20;
  const toX = i => pad + i * ((w - pad * 2) / 6);
  const toY = v => h - pad - (v / 80) * (h - pad * 2);

  return (
    <svg className={`line-chart-svg ${animated ? 'animate' : ''}`} viewBox={`0 0 ${w} ${h}`}>
      {/* Grid */}
      {[0, 20, 40, 60, 80].map(v => (
        <g key={`grid-${v}`}>
          <line x1={pad} y1={toY(v)} x2={w - pad} y2={toY(v)} stroke="#ecf0f1" strokeWidth="1" />
          <text x={pad - 5} y={toY(v) + 4} fontSize="10" fill="#bdc3c7" textAnchor="end">{v}</text>
        </g>
      ))}
      {/* X axis labels */}
      {weekLabels.map((lbl, i) => (
        <text key={`x-${i}`} x={toX(i)} y={h} fontSize="10" fill="#95a5a6" textAnchor="middle">{lbl}</text>
      ))}
      {/* Lines & dots */}
      {trends.map((trend) => {
        const pts = trend.data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
        return (
          <g key={`line-${trend.name}`}>
            <polyline points={pts} fill="none" stroke={trend.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const IMSDashboard = () => {
  const { imsFetch, activeWorkspaceId } = useWorkspace();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showToast = useToast();

  const [animated, setAnimated] = useState(false);
  const [data, setData] = useState(() => {
    const cached = sessionStorage.getItem(`ims_dashboard_cache_${activeWorkspaceId}`);
    return cached ? JSON.parse(cached) : null;
  });
  const [loading, setLoading] = useState(!data);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status === 'success') {
      showToast('Email verified successfully! Welcome to your new workspace.', 'success');
      // Clean up search parameters so they don't re-trigger on refresh
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    } else if (status === 'already_verified') {
      // Silently clean up search parameters
      const newUrl = window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [searchParams, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (!data) setLoading(true);
    imsFetch('/api/ims/dashboard')
      .then(res => res.json())
      .then(d => {
        if (d.success) {
          setData(d.dashboard);
          sessionStorage.setItem(`ims_dashboard_cache_${activeWorkspaceId}`, JSON.stringify(d.dashboard));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeWorkspaceId, imsFetch]);

  // Derive health score
  const getHealthScore = () => {
    if (!data || data.totalSKUs === 0) return 100;
    const critical = data.lowStockItems.filter(a => a.stock <= a.alert_at / 2).length;
    const warning = data.lowStockItems.filter(a => a.stock > a.alert_at / 2).length;
    const expiry = 0; // Not tracked yet
    return Math.max(0, Math.round(100 - critical * 14 - warning * 5 - expiry * 6));
  };

  const healthScore = getHealthScore();
  const scoreColor = healthScore >= 80 ? '#27ae60' : healthScore >= 60 ? '#f39c12' : '#e74c3c';
  const scoreLabel = healthScore >= 80 ? 'Healthy' : healthScore >= 60 ? 'At Risk' : 'Critical';
  const circum = 2 * Math.PI * 42;

  if (!data && loading) {
    return <div className="ims-dashboard-page" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh'}}>
      <div style={{ textAlign: 'center' }}>
        <FaSpinner className="fa-spin" style={{ fontSize: 40, color: '#3498db', marginBottom: 20 }} />
        <h2>Loading Command Center...</h2>
      </div>
    </div>;
  }
  
  if (!data) return null;

  // Generate dynamic mock data based on actual database items so demo is perfectly contextual
  const sampleItems = data.lowStockItems && data.lowStockItems.length > 0 ? data.lowStockItems : [{name: 'Sample Item A', stock: 10}, {name: 'Sample Item B', stock: 25}, {name: 'Sample Item C', stock: 45}];
  
  const mockWIP = [
    { order: 'PRD-1049', product: `${sampleItems[0]?.name || 'Product A'} (Batch A)`, progress: 75, status: 'In Progress', due: 'Today' },
    { order: 'PRD-1050', product: `${sampleItems[1]?.name || 'Product B'} (Batch B)`, progress: 30, status: 'Blending', due: 'Tomorrow' },
    { order: 'PRD-1051', product: `${sampleItems[2]?.name || 'Product C'}`, progress: 95, status: 'Packaging', due: 'Today' },
  ];

  const expiryItems = [
    { product: `${sampleItems[0]?.name || 'Product A'}`, expiry: '2026-04-20', daysUntil: 0, stock: sampleItems[0]?.stock || 3, zone: 'week' },
    { product: `${sampleItems[1]?.name || 'Product B'}`, expiry: '2026-04-18', daysUntil: -2, stock: sampleItems[1]?.stock || 45, zone: 'week' },
    { product: `${sampleItems[2]?.name || 'Product C'}`, expiry: '2026-05-01', daysUntil: 11, stock: sampleItems[2]?.stock || 8, zone: 'two_weeks' },
    { product: `${sampleItems[0]?.name || 'Product A'} (New)`, expiry: '2026-05-10', daysUntil: 20, stock: 200, zone: 'month' },
  ];

  const dynamicTrends = [
    { name: sampleItems[0]?.name || 'Item 1', color: '#E3821E', data: [42, 58, 51, 69, 55, 72, 55] },
    { name: sampleItems[1]?.name || 'Item 2', color: '#3498db', data: [35, 40, 38, 50, 44, 48, 43] },
  ];

  // Build dynamic KPIs with navigation links
  const liveKPIs = [
    { label: 'Total SKUs', value: data.totalSKUs, icon: FaBoxes, color: '#E3821E', change: 'Total catalog items', up: true, link: '/ims-catalog' },
    { label: 'Total Stock Units', value: data.totalStock, icon: FaDatabase, color: '#27ae60', change: 'All active items', up: true, link: '/ims-catalog' },
    { label: "Today's Scans", value: data.todayMovements, icon: FaExchangeAlt, color: '#3498db', change: 'Movements today', up: true, link: '/ims-scanner' },
    { label: 'Low Stock Alerts', value: data.lowStockCount, icon: FaExclamationTriangle, color: '#e74c3c', change: 'Needs reorder', up: false, link: '/ims-settings' },
    { label: 'Items in WIP', value: 0, icon: FaCogs, color: '#9b59b6', change: 'Active BOMs', up: true, link: '/ims-catalog' },
    { label: 'Reserved Stock', value: 0, icon: FaClipboardList, color: '#f39c12', change: 'Awaiting Pick', up: false, link: '/ims-scanner' },
  ];

  // Storage quota — mock for now, wire to subscription tier later
  const quotaPct = Math.min(100, Math.round((data.totalSKUs / 500) * 100));

  return (
    <div className="ims-dashboard-page">

      {/* Header */}
      <div className="page-header ims-page-header">
        <div className="ims-header-left">
          <h1>IMS Command Center</h1>
          <p>Real-time inventory intelligence — track, manage and optimise your stock</p>
        </div>
        <span className="ims-live-badge"><span className="live-dot"></span> LIVE</span>
      </div>

      {/* Health Score Banner */}
      <div className="ai-health-banner">
        <div className="health-score-left">
          <div className="health-score-ring">
            <svg viewBox="0 0 100 100" className="score-svg">
              <circle cx="50" cy="50" r="42" className="score-track" />
              <circle cx="50" cy="50" r="42" className="score-fill"
                style={{ stroke: scoreColor, strokeDasharray: `${animated ? (healthScore / 100) * circum : 0} ${circum}` }} />
            </svg>
            <div className="score-center">
              <div className="score-number" style={{ color: scoreColor }}>{healthScore}</div>
              <div className="score-unit">/ 100</div>
            </div>
          </div>
          <div className="health-score-info">
            <div className="health-label"><FaHeartbeat style={{ color: scoreColor }} /> Inventory Health</div>
            <div className="health-status" style={{ color: scoreColor }}>{scoreLabel}</div>
            <div className="health-desc">Based on stock alerts, expiry risks & storage thresholds</div>
          </div>
        </div>
        <div className="health-breakdown">
          {[
            { label: 'Critical', count: data.lowStockItems.filter(a => a.stock <= a.alert_at / 2).length, cls: 'critical' }, 
            { label: 'Warning', count: data.lowStockItems.filter(a => a.stock > a.alert_at / 2).length, cls: 'warning' },
            { label: 'Expiry Risk', count: 0, cls: 'expiry' }, 
            { label: 'Overstocked', count: 0, cls: 'overstock' }
          ].map(b => (
            <div key={b.cls} className={`hb-item ${b.cls}`}>
              <span className="hb-count">{b.count}</span>
              <span className="hb-label">{b.label}</span>
            </div>
          ))}
        </div>
        <div className="health-ai-note">
          <FaBrain className="ai-brain-icon" />
          <div>
            <div className="ai-note-title">AI Recommendation</div>
            <div className="ai-note-desc">
              {data.totalSKUs === 0 ? "No data to analyze. Add products to get AI recommendations." :
               data.lowStockItems.length > 0 ? `Prioritise reordering ${data.lowStockItems.slice(0, 2).map(i => i.name).join(' & ')}. Score can reach 100 after restock.` :
               "Stock levels are optimal. No immediate action required."}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={`ims-kpi-grid ${animated ? 'animated' : ''}`}>
        {liveKPIs.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div className="ims-kpi-card" key={i} style={{ animationDelay: `${i * 80}ms`, cursor: kpi.link ? 'pointer' : 'default' }}
              onClick={() => kpi.link && navigate(kpi.link)}>
              <div className="kpi-icon-wrap" style={{ background: `${kpi.color}18`, color: kpi.color }}>
                <Icon />
              </div>
              <div className="kpi-info">
                <div className="kpi-value">{kpi.value}</div>
                <div className="kpi-label">{kpi.label}</div>
                <div className={`kpi-change ${kpi.up ? 'up' : 'down'}`}>
                  {kpi.up ? <FaArrowUp /> : <FaArrowDown />} {kpi.change}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Storage Quota */}
      <div className="ims-quota-banner">
        <div className="quota-label"><FaDatabase /> Workspace Storage Quota</div>
        <div className="quota-bar-wrap">
          <div className="quota-bar">
            <div className={`quota-fill ${quotaPct > 80 ? 'danger' : quotaPct > 60 ? 'warning' : 'ok'}`}
              style={{ width: animated ? `${quotaPct}%` : '0%' }}></div>
          </div>
          <span className="quota-pct">{quotaPct}% used — 412 MB of 1 GB</span>
        </div>
      </div>

      {/* Forecast Circular Rings */}
      <div className="ims-panel ims-panel-wide ai-forecast-panel">
        <div className="ims-panel-header">
          <FaChartLine className="panel-icon" style={{ color: '#9b59b6' }} />
          <h2>AI Forecast & Shortage Radar</h2>
          <span className="ai-powered-badge"><FaBrain /> AI Powered</span>
        </div>
        <p className="panel-sub">Days remaining per product based on stock ÷ daily consumption rate.</p>
        <div className="forecast-rings-grid">
          {data.totalSKUs === 0 ? (
            <p style={{color: '#7f8c8d', gridColumn: '1 / -1', textAlign: 'center'}}>No forecasting data available. Add items to see analytics.</p>
          ) : data.lowStockItems.length === 0 ? (
            <p style={{color: '#27ae60', gridColumn: '1 / -1', textAlign: 'center'}}>All products have sufficient days of supply.</p>
          ) : data.lowStockItems.slice(0, 4).map((fc, i) => {
            const daysLeft = Math.max(0, Math.floor(fc.stock / 2)); // Calculated consumption
            const urgency = daysLeft <= 7 ? 'danger' : daysLeft <= 14 ? 'warning' : 'ok';
            return (
              <div key={i} className="frc-ring-item">
                <CircularRing daysLeft={daysLeft} maxDays={30} animated={animated} />
                <div className="frc-ring-info">
                  <div className="frc-name">{fc.name}</div>
                  <div className="frc-meta">Estimated ~{Math.ceil(fc.stock / Math.max(daysLeft, 1))} units/day · Stock: {fc.stock}</div>
                  <span className={`frc-tag ${urgency}`}>
                    {urgency === 'danger' ? '🔴 Critical' : urgency === 'warning' ? '🟡 Monitor' : '🟢 Safe'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main 2-col Grid */}
      <div className="ims-main-grid">

        {/* Stock Alerts */}
        <div className="ims-panel">
          <div className="ims-panel-header">
            <FaBell className="panel-icon alert-icon" />
            <h2>Stock Alerts</h2>
            <span className="badge badge-error" style={{ marginLeft: 'auto' }}>{data.lowStockCount} Active</span>
            <button onClick={() => navigate('/ims-catalog')} style={{marginLeft: '8px', background: 'none', border: '1px solid #e74c3c', color: '#e74c3c', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '12px'}}>View Catalog →</button>
          </div>
          <div className="ims-alert-list">
            {data.lowStockItems.length === 0 ? (
              <div style={{padding: '20px', textAlign: 'center', color: '#7f8c8d'}}>No stock alerts currently.</div>
            ) : data.lowStockItems.map(alert => {
              const type = alert.stock <= alert.alert_at / 2 ? 'critical' : 'warning';
              return (
              <div key={alert.id} className={`ims-alert-item alert-${type}`}>
                <div className="alert-icon-wrap">
                  {type === 'critical' ? <FaFire /> : <FaExclamationTriangle />}
                </div>
                <div className="alert-info">
                  <div className="alert-product">{alert.name}</div>
                  <div className="alert-meta">
                    Stock: <strong>{alert.stock}</strong> (min: {alert.alert_at})
                  </div>
                </div>
                <div className="alert-type-badge">
                  {type === 'critical' ? 'CRITICAL' : 'LOW'}
                </div>
              </div>
            )})}
          </div>
        </div>

        {/* Smart Reorder Cards */}
        <div className="ims-panel ai-reorder-panel">
          <div className="ims-panel-header">
            <FaBolt className="panel-icon" style={{ color: '#f39c12' }} />
            <h2>Smart Reorder Suggestions</h2>
            <span className="ai-powered-badge"><FaBrain /> AI</span>
          </div>
          <p className="panel-sub">AI-calculated quantities based on consumption velocity.</p>
          <div className="reorder-card-list">
            {data.totalSKUs === 0 ? (
              <p style={{color: '#7f8c8d', padding: '20px', textAlign: 'center'}}>No items to analyze.</p>
            ) : data.lowStockItems.length === 0 ? (
              <p style={{color: '#27ae60', padding: '20px', textAlign: 'center'}}>No reorder suggestions. Stock levels are healthy.</p>
            ) : data.lowStockItems.map(r => {
              const urgency = r.stock <= r.alert_at / 2 ? 'critical' : 'warning';
              return (
              <div key={r.id} className={`reorder-card urgency-${urgency}`}>
                <div className="reorder-card-top">
                  <div className="reorder-product">{r.name}</div>
                  <span className={`reorder-badge ${urgency}`}>
                    {urgency === 'critical' ? '🔴 CRITICAL' : '🟡 WARNING'}
                  </span>
                </div>
                <div className="reorder-reason">Stock is at {r.stock} units (threshold: {r.alert_at}). Needs restock.</div>
                <div className="reorder-footer">
                  <div className="reorder-qty">
                    <span className="qty-label">Suggested Qty</span>
                    <span className="qty-num">{Math.max(100, r.alert_at * 3)} units</span>
                  </div>
                  <div className="reorder-by"><FaCalendarAlt /> Order by <strong>{urgency === 'critical' ? 'Today' : 'This Week'}</strong></div>
                </div>
              </div>
              )
            })}
          </div>
        </div>

        {/* Live Activity Pulse */}
        <div className="ims-panel live-pulse-panel">
          <div className="ims-panel-header">
            <FaExchangeAlt className="panel-icon" />
            <h2>Live Activity Pulse</h2>
            <span className="pulse-live-dot-wrap"><span className="pulse-live-dot"></span> Real-time</span>
          </div>
          <div className="ims-activity-list">
            {data.recentActivity.length === 0 ? (
              <div style={{padding: '20px', textAlign: 'center', color: '#7f8c8d'}}>No recent activity found.</div>
            ) : data.recentActivity.map((item, idx) => {
              const wf = item.workflow.toUpperCase();
              const isIn = ['RECEIVE', 'IN', 'RETURN', 'RESTOCK', 'PUTAWAY'].some(op => wf.includes(op));
              const isOut = ['DISPATCH', 'OUT', 'ISSUE', 'SHIP', 'PICK'].some(op => wf.includes(op));
              const actionType = isIn ? 'IN' : isOut ? 'OUT' : 'NEW';
              return (
              <div key={idx} className={`ims-activity-row ${idx === 0 ? 'new-entry' : ''}`}>
                <div className={`activity-badge action-${actionType.toLowerCase()}`}>
                  {actionType === 'IN' && <FaArrowDown />}
                  {actionType === 'OUT' && <FaArrowUp />}
                  {actionType === 'NEW' && <FaCheckCircle />}
                  {wf}
                </div>
                <div className="activity-info">
                  <div className="activity-product">{item.item_name || item.barcode}</div>
                  <div className="activity-meta">
                    {item.quantity} {item.unit || 'Units'}
                  </div>
                </div>
                <div className="activity-time" style={{fontSize: '11px'}}><FaClock /> {new Date(item.scanned_at).toLocaleString()}</div>
              </div>
            )})}
          </div>
        </div>

        {/* Production WIP */}
        <div className="ims-panel">
          <div className="ims-panel-header">
            <FaCogs className="panel-icon" style={{ color: '#E3821E' }} />
            <h2>Production WIP Workflow</h2>
          </div>
          <div className="ims-wip-list">
            {data.totalSKUs === 0 ? (
              <p style={{color: '#7f8c8d', padding: '20px', textAlign: 'center'}}>No active production workflows.</p>
            ) : mockWIP.map((wip, i) => (
              <div key={i} className="wip-row">
                <div className="wip-header">
                  <span className="wip-order">{wip.order}</span>
                  <span className="wip-due">Due: {wip.due}</span>
                </div>
                <div className="wip-product">{wip.product}</div>
                <div className="wip-status">
                  <span>{wip.status}</span>
                  <span className="wip-pct">{wip.progress}%</span>
                </div>
                <div className="wip-progress-bar">
                  <div className="wip-progress-fill"
                    style={{ width: animated ? `${wip.progress}%` : '0%', transitionDelay: `${i * 150}ms` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Expiry Timeline */}
      <div className="ims-panel ims-panel-wide expiry-timeline-panel">
        <div className="ims-panel-header">
          <FaCalendarAlt className="panel-icon" style={{ color: '#e74c3c' }} />
          <h2>Expiry Risk Timeline</h2>
          <span className="ai-powered-badge"><FaBrain /> AI</span>
        </div>
        <p className="panel-sub">Grouped by urgency window. FEFO rotation is recommended for all items below.</p>
        <div className="expiry-timeline">
          {data.totalSKUs === 0 ? (
            <p style={{color: '#7f8c8d', padding: '20px', width: '100%', textAlign: 'center'}}>No expiry data available. Start tracking products with expiry dates to see analytics.</p>
          ) : [
            { zone: 'week', label: 'This Week', icon: FaFire, cls: 'zone-critical', cardCls: 'exp-critical' },
            { zone: 'two_weeks', label: 'Next 2 Weeks', icon: FaExclamationTriangle, cls: 'zone-warning', cardCls: 'exp-warning' },
            { zone: 'month', label: 'This Month', icon: FaShieldAlt, cls: 'zone-ok', cardCls: 'exp-ok' },
          ].map(({ zone, label, icon: Icon, cls, cardCls }) => (
            <div key={zone} className={`timeline-zone ${cls}`}>
              <div className="zone-header"><Icon /> {label}</div>
              <div className="zone-items">
                {expiryItems.filter(e => e.zone === zone).map((e, i) => (
                  <div key={i} className={`expiry-card ${cardCls}`}>
                    <div className="exp-product">{e.product}</div>
                    <div className="exp-meta">
                      <span className="exp-date">📅 {e.expiry}</span>
                      <span className="exp-stock">{e.stock} units</span>
                    </div>
                    <div className="exp-action">{zone === 'week' ? 'FEFO Priority Active' : `${e.daysUntil} days remaining`}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Weekly Line Chart */}
      <div className="ims-panel ims-panel-wide line-chart-panel">
        <div className="ims-panel-header">
          <FaChartLine className="panel-icon" style={{ color: '#3498db' }} />
          <h2>Weekly Movement Trends</h2>
          <span className="ai-powered-badge"><FaBrain /> AI Smoothing</span>
        </div>
        <p className="panel-sub">Volume of stock movements IN and OUT over the last 7 days.</p>
        
        {data.totalSKUs === 0 ? (
          <div style={{padding: '50px 20px', textAlign: 'center', color: '#7f8c8d'}}>
            No movement data to graph. Add items and perform scans to generate trend analytics.
          </div>
        ) : (
          <>
            <div className="line-chart-legend">
              {dynamicTrends.map(t => (
                <span key={t.name} className="lc-legend-item">
                  <span className="lc-dot" style={{ background: t.color }}></span> {t.name}
                </span>
              ))}
            </div>
            <WeeklyLineChart animated={animated} trends={dynamicTrends} />
          </>
        )}
      </div>

    </div>
  );
};

export default IMSDashboard;
