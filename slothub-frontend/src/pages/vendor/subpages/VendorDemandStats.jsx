import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { Loader2, TrendingUp, TrendingDown, Minus, RefreshCw, Trophy, Info, LineChart as LineIcon, CalendarRange } from 'lucide-react';
import api from '../../../api/axios';
import { appAlert } from '../../../utils/appAlert';

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const COLORS = ['#F27124', '#3B82F6', '#10B981', '#A855F7', '#EF4444'];
const pad = (n) => String(n).padStart(2, '0');
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const shortDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('vi-VN') : '');

const PRESETS = [
  { id: '7', label: '7 ngày', days: 7, granularity: 'day' },
  { id: '30', label: '30 ngày', days: 30, granularity: 'day' },
  { id: '90', label: '3 tháng', days: 90, granularity: 'week' },
  { id: 'custom', label: 'Tuỳ chọn' },
];

const TrendBadge = ({ trend, pct }) => {
  if (pct == null) return <span className="portal-muted text-xs">—</span>;
  const Icon = trend === 'up' || pct > 0 ? TrendingUp : trend === 'down' || pct < 0 ? TrendingDown : Minus;
  const cls = trend === 'up' || (trend == null && pct > 0) ? 'text-green-500' : trend === 'down' || (trend == null && pct < 0) ? 'text-red-500' : 'portal-muted';
  return <span className={`inline-flex items-center gap-1 text-xs font-black ${cls}`}><Icon size={14} />{pct > 0 ? '+' : ''}{pct}%</span>;
};

const Card = ({ title, icon, children, right }) => (
  <div className="portal-card border border-[var(--portal-border)] rounded-2xl p-5">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h3 className="font-black text-base flex items-center gap-2">{icon}{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

/** Thống kê món nổi bật + dự báo nhu cầu 30/60 ngày (chỉ đơn hợp lệ của quầy) */
const VendorDemandStats = () => {
  const [preset, setPreset] = useState('30');
  const [from, setFrom] = useState(toInput(daysAgo(29)));
  const [to, setTo] = useState(toInput(new Date()));
  const [granularity, setGranularity] = useState('day');
  const [horizon, setHorizon] = useState(30);
  const [top, setTop] = useState(null);
  const [series, setSeries] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forecastLoading, setForecastLoading] = useState(true);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const q = `from=${from}&to=${to}`;
      const [t, s] = await Promise.all([
        api.get(`/vendor/stats/top-items?${q}&limit=10`),
        api.get(`/vendor/stats/timeseries?${q}&granularity=${granularity}`),
      ]);
      setTop(t.data);
      setSeries(s.data);
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không tải được thống kê', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [from, to, granularity]);

  const loadForecast = useCallback(async () => {
    setForecastLoading(true);
    try {
      const res = await api.get(`/vendor/stats/forecast?horizonDays=${horizon}`);
      setForecast(res.data);
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không tải được dự báo', { type: 'error' });
    } finally {
      setForecastLoading(false);
    }
  }, [horizon]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadForecast(); }, [loadForecast]);

  const choosePreset = (p) => {
    setPreset(p.id);
    if (p.days) {
      setFrom(toInput(daysAgo(p.days - 1)));
      setTo(toInput(new Date()));
      setGranularity(p.granularity);
    }
  };

  // Biểu đồ dự báo: cột lịch sử + đường dự báo + dải khoảng tin cậy
  const forecastChart = useMemo(() => {
    if (!forecast?.overall) return [];
    const hist = (forecast.overall.history || []).map((h) => ({ week: h.week, history: h.quantity }));
    const fc = (forecast.overall.forecast || []).map((f) => ({ week: f.week, forecast: f.quantity, range: [f.low, f.high] }));
    if (hist.length && fc.length) {
      const last = hist[hist.length - 1];
      last.forecast = last.history; // nối liền đường lịch sử → dự báo
      last.range = [last.history, last.history];
    }
    return [...hist, ...fc];
  }, [forecast]);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* BỘ LỌC */}
      <div className="portal-card border border-[var(--portal-border)] rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <CalendarRange size={18} className="text-[#F27124]" />
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => choosePreset(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${preset === p.id ? 'bg-[#F27124] text-white border-[#F27124]' : 'border-[var(--portal-border)] portal-text-secondary'}`}
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="bg-[var(--portal-input-bg)] border border-[var(--portal-border)] rounded-lg px-2 py-1.5" />
            <span>→</span>
            <input type="date" value={to} min={from} max={toInput(new Date())} onChange={(e) => setTo(e.target.value)} className="bg-[var(--portal-input-bg)] border border-[var(--portal-border)] rounded-lg px-2 py-1.5" />
          </div>
        )}
        <div className="flex gap-1 ml-auto">
          {[['day', 'Theo ngày'], ['week', 'Theo tuần']].map(([g, label]) => (
            <button key={g} type="button" onClick={() => setGranularity(g)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${granularity === g ? 'bg-[var(--portal-text)] text-[var(--portal-card)] border-transparent' : 'border-[var(--portal-border)] portal-text-secondary'}`}>{label}</button>
          ))}
          <button type="button" onClick={() => { loadStats(); loadForecast(); }} className="px-3 py-1.5 rounded-lg border border-[var(--portal-border)]" title="Tải lại">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !top ? (
        <div className="flex justify-center p-10"><Loader2 className="animate-spin text-[#F27124]" size={36} /></div>
      ) : top && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Đơn hợp lệ', top.totals.orders],
              ['Tổng phần bán', top.totals.quantity],
              ['Doanh thu món', vnd(top.totals.revenue)],
              ['Số món có người đặt', top.totals.distinctItems],
            ].map(([label, value]) => (
              <div key={label} className="portal-card border border-[var(--portal-border)] rounded-2xl p-4">
                <p className="text-xs font-bold portal-muted uppercase">{label}</p>
                <p className="text-2xl font-black mt-1">{value}</p>
              </div>
            ))}
          </div>

          {/* TOP MÓN */}
          <Card title="Món được đặt nhiều nhất" icon={<Trophy size={18} className="text-[#F27124]" />} right={<span className="text-xs portal-muted">Cập nhật {fmtTime(top.generatedAt)}</span>}>
            {top.items.length === 0 ? (
              <p className="text-sm portal-muted">Chưa có đơn hợp lệ nào trong khoảng thời gian này.</p>
            ) : (
              <div className="grid lg:grid-cols-2 gap-5">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top.items} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--portal-border)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${v} phần`, 'Số phần bán']} />
                      <Bar dataKey="quantity" fill="#F27124" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs portal-muted uppercase">
                        <th className="py-2">#</th><th>Món</th><th className="text-right">Lượt đặt</th><th className="text-right">Phần</th><th className="text-right">Doanh thu</th><th className="text-right">So kỳ trước</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top.items.map((i) => (
                        <tr key={i._id} className="border-t border-[var(--portal-border)]">
                          <td className="py-2 font-black">{i.rank}</td>
                          <td className="font-bold">{i.name}{!i.isAvailable && <span className="ml-1 text-[10px] text-red-500">(ngừng bán)</span>}<div className="text-[11px] portal-muted font-medium">{i.share}% tổng phần</div></td>
                          <td className="text-right">{i.orderCount}</td>
                          <td className="text-right font-black">{i.quantity}</td>
                          <td className="text-right">{vnd(i.revenue)}</td>
                          <td className="text-right"><TrendBadge pct={i.changePct} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          {/* LƯỢT ĐẶT THEO THỜI GIAN */}
          {series && (
            <Card title={`Số phần bán theo ${series.granularity === 'week' ? 'tuần' : 'ngày'}`} icon={<LineIcon size={18} className="text-[#F27124]" />}>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series.series} margin={{ right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--portal-border)" />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={20} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(l) => `${series.granularity === 'week' ? 'Tuần từ ' : ''}${shortDate(l)}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="quantity" name="Tổng phần" stroke="#64748B" strokeWidth={2} dot={false} strokeDasharray="5 4" />
                    {series.topItems.map((it, idx) => (
                      <Line key={it._id} type="monotone" dataKey={it._id} name={it.name} stroke={COLORS[idx % COLORS.length]} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </>
      )}

      {/* DỰ BÁO NHU CẦU */}
      <Card
        title="Dự báo nhu cầu"
        icon={<TrendingUp size={18} className="text-[#F27124]" />}
        right={(
          <div className="flex gap-1">
            {[30, 60].map((h) => (
              <button key={h} type="button" onClick={() => setHorizon(h)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${horizon === h ? 'bg-[#F27124] text-white border-[#F27124]' : 'border-[var(--portal-border)] portal-text-secondary'}`}>
                {h} ngày tới
              </button>
            ))}
          </div>
        )}
      >
        {forecastLoading && !forecast ? (
          <Loader2 className="animate-spin text-[#F27124]" />
        ) : forecast && (
          <div className="space-y-4">
            <p className={`text-sm font-bold ${forecast.sufficient ? 'portal-text-secondary' : 'text-amber-600'}`}>{forecast.message}</p>

            {forecast.sufficient ? (
              <>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="rounded-xl bg-[var(--portal-input-bg)] p-3">
                    <p className="text-xs portal-muted font-bold uppercase">Tổng phần dự kiến {horizon} ngày</p>
                    <p className="text-xl font-black">{forecast.overall.total} <span className="text-xs portal-muted font-bold">({forecast.overall.low}–{forecast.overall.high})</span></p>
                  </div>
                  <div className="rounded-xl bg-[var(--portal-input-bg)] p-3">
                    <p className="text-xs portal-muted font-bold uppercase">So với 4 tuần gần nhất</p>
                    <p className="text-xl font-black"><TrendBadge pct={forecast.overall.changePct} /></p>
                  </div>
                  <div className="rounded-xl bg-[var(--portal-input-bg)] p-3">
                    <p className="text-xs portal-muted font-bold uppercase">Độ tin cậy</p>
                    <p className="text-xl font-black">{forecast.overall.confidence}</p>
                  </div>
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={forecastChart} margin={{ right: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--portal-border)" />
                      <XAxis dataKey="week" tickFormatter={shortDate} tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(l) => `Tuần từ ${shortDate(l)}`}
                        formatter={(v, name) => (Array.isArray(v) ? [`${v[0]} – ${v[1]}`, 'Khoảng dự báo'] : [v, name])}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="history" name="Thực tế (phần/tuần)" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                      <Area dataKey="range" name="Khoảng dự báo ~80%" fill="#F27124" fillOpacity={0.15} stroke="none" />
                      <Line dataKey="forecast" name="Dự báo" stroke="#F27124" strokeWidth={2.5} strokeDasharray="6 4" dot />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs portal-muted uppercase">
                        <th className="py-2">Món</th>
                        <th className="text-right">TB 4 tuần gần</th>
                        <th className="text-right">Dự báo TB/tuần</th>
                        <th className="text-right">Tổng {horizon} ngày</th>
                        <th className="text-right">Xu hướng</th>
                        <th className="text-right">Tin cậy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.items.map((i) => (
                        <tr key={i._id} className="border-t border-[var(--portal-border)]">
                          <td className="py-2 font-bold">{i.name}</td>
                          <td className="text-right">{i.recentWeeklyAvg}</td>
                          <td className="text-right font-black">{i.forecastWeeklyAvg}</td>
                          <td className="text-right">{i.forecastTotal} <span className="text-[11px] portal-muted">({i.low}–{i.high})</span></td>
                          <td className="text-right"><TrendBadge trend={i.trend} pct={i.changePct} /></td>
                          <td className="text-right text-xs font-bold">{i.confidence} <span className="portal-muted font-medium">R² {i.r2}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(forecast.rising?.length > 0 || forecast.falling?.length > 0) && (
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-3">
                      <p className="font-black text-green-600 flex items-center gap-1 mb-1"><TrendingUp size={16} /> Có khả năng tăng</p>
                      {forecast.rising.length ? forecast.rising.map((i) => <p key={i._id}>{i.name} (+{i.changePct}%)</p>) : <p className="portal-muted">—</p>}
                    </div>
                    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                      <p className="font-black text-red-500 flex items-center gap-1 mb-1"><TrendingDown size={16} /> Có khả năng giảm</p>
                      {forecast.falling.length ? forecast.falling.map((i) => <p key={i._id}>{i.name} ({i.changePct}%)</p>) : <p className="portal-muted">—</p>}
                    </div>
                  </div>
                )}
              </>
            ) : forecast.items?.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs portal-muted uppercase"><th className="py-2">Món</th><th className="text-right">Tổng phần đã bán</th><th className="text-right">TB/tuần</th></tr></thead>
                <tbody>
                  {forecast.items.map((i) => (
                    <tr key={i._id} className="border-t border-[var(--portal-border)]"><td className="py-2 font-bold">{i.name}</td><td className="text-right">{i.historyTotal}</td><td className="text-right">{i.historyWeeklyAvg}</td></tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="text-[11px] portal-muted space-y-1 border-t border-[var(--portal-border)] pt-3">
              <p className="flex gap-1"><Info size={12} className="shrink-0 mt-0.5" /> <span><strong>Phương pháp:</strong> {forecast.method}</span></p>
              {forecast.historyRange && <p><strong>Dữ liệu lịch sử:</strong> {new Date(forecast.historyRange.from).toLocaleDateString('vi-VN')} → {new Date(forecast.historyRange.to).toLocaleDateString('vi-VN')} ({forecast.historyRange.weeks} tuần)</p>}
              <p><strong>Khoảng dự báo:</strong> {new Date(forecast.horizon.from).toLocaleDateString('vi-VN')} → {new Date(forecast.horizon.to).toLocaleDateString('vi-VN')}</p>
              <p><strong>Đơn được tính:</strong> {forecast.validOrderRule}</p>
              <p>Dự báo mang tính tham khảo, không đảm bảo chính xác tuyệt đối. Cập nhật {fmtTime(forecast.generatedAt)}.</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default VendorDemandStats;
