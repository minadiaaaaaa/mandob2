import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { download, post } from '../api';
import { fmtBytes, fmtNum, useI18n } from '../i18n';
import { Alert, Badge, Button, Card, cx, Field, StatCard, Switch, useAction, useErrorText } from './kit';

type Preview = {
  token: string; matchOn: string; rows: number; readable: number; new: number; replace: number; skip: number; problems: number;
  problemList: { line: number; reason: string }[]; unknownColumns: string[]; duplicateColumns: string[]; absentColumns: string[];
  warnings: string[]; extra: Record<string, number>; sample: { line: number; key: string; label?: string; action: 'insert' | 'replace' | 'skip' }[];
};

// All import screens: "File" → "Preview" (writes nothing) → "Result".
export function ImportWizard({ base, back, options = [], modeLabels, extraLabels = {}, intro, onFinished }: {
  base: string; back: string; options?: { name: string; label: ReactNode; hint?: ReactNode }[];
  modeLabels?: { question: string; skip: string; replace: string }; extraLabels?: Record<string, string>; intro?: ReactNode; onFinished?: () => void;
}) {
  const { t } = useI18n();
  const run = useAction();
  const errText = useErrorText();
  const [step, setStep] = useState<'file' | 'preview' | 'result'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'skip' | 'replace'>('skip');
  const [opts, setOpts] = useState<Record<string, boolean>>({});
  const [pv, setPv] = useState<Preview | null>(null);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const labels = modeLabels ?? { question: t('import.on_duplicate'), skip: t('import.skip'), replace: t('import.replace') };

  const preview = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file); fd.append('mode', mode);
    for (const [k, v] of Object.entries(opts)) fd.append(k, v ? '1' : '0');
    setBusy(true); setErr(null);
    try { setPv(await post<Preview>(`${base}/preview`, fd)); setStep('preview'); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  };
  const execute = async () => {
    setBusy(true);
    const r = await run(() => post(`${base}/run`, { token: pv!.token }));
    setBusy(false);
    if (r) { setResult(r); setStep('result'); onFinished?.(); }
  };
  const restart = () => { setStep('file'); setFile(null); setPv(null); setResult(null); setErr(null); };
  const steps = [['file', t('import.step_file')], ['preview', t('import.step_preview')], ['result', t('import.step_result')]] as const;

  return (
    <div className="space-y-4">
      <ol className="flex gap-2 text-sm">
        {steps.map(([k, label], i) => (
          <li key={k} className={cx('flex items-center gap-2 rounded-lg px-3 py-1.5', step === k ? 'bg-brand text-white' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800')}>
            <span className="num">{i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {step === 'file' && (
        <Card title={t('import.step_file')} actions={<Button size="sm" icon={<Download className="size-3.5" />} onClick={() => run(() => download(`${base}/template`))}>{t('import.download_template')}</Button>}>
          <div className="space-y-4">
            {intro}
            <div>
              <input ref={input} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              {file ? (
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                  <FileSpreadsheet className="size-4 text-emerald-600" />
                  <span className="flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-zinc-500 num">{fmtBytes(file.size)}</span>
                  <button className="text-zinc-400 hover:text-zinc-700" onClick={() => setFile(null)}><X className="size-4" /></button>
                </div>
              ) : (
                <Button icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>{t('import.choose_file')}</Button>
              )}
              <p className="mt-1 text-xs text-zinc-500">{t('import.formats')}</p>
            </div>
            <Field label={labels.question}>
              <div className="flex gap-4 text-sm">
                {(['skip', 'replace'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2"><input type="radio" checked={mode === m} onChange={() => setMode(m)} className="accent-[var(--brand)]" />{m === 'skip' ? labels.skip : labels.replace}</label>
                ))}
              </div>
            </Field>
            {options.map((o) => (
              <div key={o.name}>
                <Switch checked={!!opts[o.name]} onChange={(v) => setOpts({ ...opts, [o.name]: v })} label={o.label} />
                {o.hint && <p className="ms-11 text-xs text-zinc-500">{o.hint}</p>}
              </div>
            ))}
            {err && <Alert tone="red">{err}</Alert>}
            <div className="flex gap-2">
              <Button variant="primary" disabled={!file} loading={busy} onClick={preview}>{t('import.preview')}</Button>
              <Link to={back}><Button>{t('common.cancel')}</Button></Link>
            </div>
          </div>
        </Card>
      )}

      {step === 'preview' && pv && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label={t('import.rows_in_file')} value={fmtNum(pv.rows)} />
            <StatCard label={t('import.readable')} value={fmtNum(pv.readable)} />
            <StatCard label={t('import.new')} value={fmtNum(pv.new)} tone="green" />
            <StatCard label={t('import.would_replace')} value={fmtNum(pv.replace)} tone={pv.replace ? 'amber' : 'none'} />
            <StatCard label={t('import.would_skip')} value={fmtNum(pv.skip)} />
            <StatCard label={t('import.problems')} value={fmtNum(pv.problems)} tone={pv.problems ? 'red' : 'none'} />
            {Object.entries(pv.extra).map(([k, v]) => <StatCard key={k} label={extraLabels[k] ?? t(`import.x.${k}`)} value={fmtNum(v)} />)}
          </div>
          <Alert tone="blue">{t('import.match_on', { field: t(pv.matchOn) })}</Alert>
          {pv.unknownColumns.length > 0 && <Alert tone="amber" title={t('import.unknown_columns')}>{pv.unknownColumns.join('، ')}</Alert>}
          {pv.duplicateColumns.length > 0 && <Alert tone="amber" title={t('import.duplicate_columns')}>{pv.duplicateColumns.join('، ')}</Alert>}
          {pv.absentColumns.length > 0 && <Alert tone="grey" title={t('import.absent_columns')}>{pv.absentColumns.map((c) => t(`import.col.${c}`)).join('، ')}</Alert>}
          {pv.warnings.length > 0 && (
            <Alert tone="amber" title={t('import.not_registered')}>
              {pv.warnings.map((w) => { const [kind, ...name] = w.split(':'); return `${t(`import.kind.${kind}`)}: ${name.join(':')}`; }).join(' · ')}
            </Alert>
          )}
          {pv.problemList.length > 0 && (
            <Card title={t('import.first_problems')}>
              <ul className="space-y-1 text-sm">
                {pv.problemList.map((p, i) => <li key={i}><span className="num font-medium">{t('import.row', { n: p.line })}</span> — {t(`import.p.${p.reason}`)}</li>)}
              </ul>
            </Card>
          )}
          {pv.readable === 0 && <Alert tone="red">{t('import.no_rows')}</Alert>}
          <Card title={t('import.sample')} pad={false}>
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900"><tr><th className="px-3 py-2 text-start">{t('import.row_h')}</th><th className="px-3 py-2 text-start">{t(pv.matchOn)}</th><th className="px-3 py-2 text-start">{t('common.name')}</th><th className="px-3 py-2 text-start">{t('import.action')}</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {pv.sample.map((s) => (
                  <tr key={s.line}><td className="px-3 py-1.5 num">{s.line}</td><td className="px-3 py-1.5 num">{s.key.replace(/^(id|nid):/, '')}</td><td className="px-3 py-1.5">{s.label}</td>
                    <td className="px-3 py-1.5"><Badge tone={s.action === 'insert' ? 'green' : s.action === 'replace' ? 'amber' : 'red'}>{t(`import.a.${s.action}`)}</Badge></td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex gap-2">
            <Button variant="primary" disabled={pv.readable === 0} loading={busy} onClick={execute}>{t('import.run')}</Button>
            <Button onClick={() => setStep('file')}>{t('common.cancel')}</Button>
          </div>
        </>
      )}

      {step === 'result' && result && (
        <Card title={t('import.finished')}>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('import.inserted')} value={fmtNum(result.inserted)} tone="green" />
            <StatCard label={t('import.replaced')} value={fmtNum(result.replaced)} tone="amber" />
            <StatCard label={t('import.skipped')} value={fmtNum(result.skipped)} />
            <StatCard label={t('import.failed')} value={fmtNum(result.failed ?? 0)} tone={result.failed ? 'red' : 'none'} />
            {Object.entries(result).filter(([k]) => !['inserted', 'replaced', 'skipped', 'failed'].includes(k)).map(([k, v]) => <StatCard key={k} label={extraLabels[k] ?? t(`import.x.${k}`)} value={fmtNum(v)} />)}
          </div>
          <div className="flex gap-2">
            <Link to={back}><Button variant="primary">{t('import.back_to_list')}</Button></Link>
            <Button onClick={restart}>{t('import.another')}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
