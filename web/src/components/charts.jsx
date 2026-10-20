import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from './ui';
import { EmptyState } from './States';

/** Categorical palette (fixed order). */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const GRID = '#e2e8f0';
const AXIS = '#64748b';

const axisProps = {
  stroke: AXIS,
  tick: { fill: AXIS, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: GRID },
};

function TooltipBox({ active, payload, label, valueFormatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-900">{labelFormatter ? labelFormatter(label) : label}</p>
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={p.dataKey} className="flex items-center gap-2 text-slate-700">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} aria-hidden="true" />
            <span>{p.name}:</span>
            <span className="font-semibold text-slate-900">{valueFormatter ? valueFormatter(p.value, p.dataKey) : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartCard({ title, subtitle, children, className, empty, height = 280 }) {
  return (
    <Card className={className}>
      <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="p-3 sm:p-4" style={{ height: empty ? undefined : height }}>
        {empty ? <EmptyState title="No data for this period" className="py-8" /> : children}
      </div>
    </Card>
  );
}

/** Multi-series line chart. series = [{ key, name }]. */
export function LineSeriesChart({ data, xKey, series, xFormatter, valueFormatter }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={16} />
        <YAxis {...axisProps} allowDecimals={false} />
        <Tooltip content={<TooltipBox labelFormatter={xFormatter} valueFormatter={valueFormatter} />} cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: AXIS }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color || SERIES[i % SERIES.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Single-series bar chart; `colorFor(row)` optionally colours each bar (e.g. status colours). */
export function SimpleBarChart({ data, xKey, yKey, name, color = SERIES[0], colorFor, valueFormatter, xFormatter, layout = 'horizontal', yDomain }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, bottom: 0, left: vertical ? 8 : -12 }} barCategoryGap="20%">
        <CartesianGrid stroke={GRID} vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" {...axisProps} tickFormatter={valueFormatter} domain={yDomain} />
            <YAxis type="category" dataKey={xKey} {...axisProps} width={110} tickFormatter={xFormatter} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} interval="preserveStartEnd" />
            <YAxis {...axisProps} allowDecimals={false} tickFormatter={valueFormatter} domain={yDomain} />
          </>
        )}
        <Tooltip content={<TooltipBox labelFormatter={xFormatter} valueFormatter={valueFormatter} />} cursor={{ fill: 'rgba(100,116,139,0.08)' }} />
        <Bar dataKey={yKey} name={name} fill={color} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={36}>
          {colorFor && data.map((row, i) => <Cell key={i} fill={colorFor(row)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
