import clsx from 'clsx';
import { Sparkles } from 'lucide-react';
import { RiskBadge } from './Badges';
import { formatMinutes, formatPercent } from '../lib/format';
import { humanize } from '../lib/constants';

/** Visualises an AI prediction ({ delay_probability, expected_delay_min, risk_score, risk_level, reasons, contributions }). */
export function AiPrediction({ prediction, compact = false }) {
  if (!prediction) return null;
  const level = prediction.risk_level;
  const score = prediction.risk_score ?? 0;
  const bar = level === 'HIGH' ? 'bg-red-500' : level === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500';
  const reasons = prediction.reasons || prediction.risk_reasons || [];
  const delay = prediction.expected_delay_min ?? prediction.predicted_delay_min;
  const contributions = (prediction.contributions || []).slice().sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 5);
  const maxImpact = Math.max(0.0001, ...contributions.map((c) => Math.abs(c.impact)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="h-5 w-5 text-indigo-600" aria-hidden="true" />
        <span className="text-sm font-semibold text-slate-900">AI delay-risk</span>
        <RiskBadge level={level} score={score} />
        {prediction.model_version && <span className="text-xs text-slate-400">model {prediction.model_version}</span>}
      </div>
      <div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Risk score">
          <div className={clsx('h-full rounded-full', bar)} style={{ width: `${Math.min(100, Math.max(2, score))}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-slate-400">
          <span>0 · Low</span>
          <span>35</span>
          <span>65</span>
          <span>High · 100</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">Chance of late return</dt>
          <dd className="text-lg font-semibold text-slate-900">{formatPercent(prediction.delay_probability)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-500">Expected delay</dt>
          <dd className="text-lg font-semibold text-slate-900">{delay != null ? formatMinutes(delay) : '—'}</dd>
        </div>
      </dl>
      {reasons.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {!compact && contributions.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top factors</p>
          <ul className="mt-2 space-y-1.5">
            {contributions.map((c) => (
              <li key={c.feature} className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-2 text-xs">
                <span className="truncate text-slate-600" title={`${humanize(c.feature)}: ${c.value}`}>
                  {humanize(c.feature)}
                </span>
                <span className="h-2 rounded-full bg-slate-100">
                  <span
                    className={clsx('block h-2 rounded-full', c.impact >= 0 ? 'bg-red-400' : 'bg-emerald-500')}
                    style={{ width: `${(Math.abs(c.impact) / maxImpact) * 100}%` }}
                  />
                </span>
                <span className={clsx('text-right font-medium', c.impact >= 0 ? 'text-red-700' : 'text-emerald-700')}>
                  {c.impact >= 0 ? '+' : ''}
                  {Number(c.impact).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-400">Red raises risk, green lowers it.</p>
        </div>
      )}
    </div>
  );
}
