import { useEffect, useState } from 'react';
import type { AgentRun, AgentStep, RepairAttempt, StepStatus } from '../core/types';
import { formatDuration, now } from '../core/utils';
import {
  IconAlert,
  IconBrain,
  IconBug,
  IconCheck,
  IconCode,
  IconEye,
  IconFlask,
  IconList,
  IconWrench,
  IconX,
  IconFile,
  IconSearch,
} from './Icons';
import './AgentTimeline.css';

const PHASE_ICON = {
  understand: IconBrain,
  inspect: IconSearch,
  plan: IconList,
  generate: IconCode,
  apply: IconFile,
  modify: IconCode,
  test: IconFlask,
  detect: IconBug,
  repair: IconWrench,
  preview: IconEye,
  done: IconCheck,
  failed: IconAlert,
} as const;

const PHASE_LABEL: Record<string, string> = {
  understand: 'Understanding',
  inspect: 'Inspecting',
  plan: 'Planning',
  generate: 'Generating',
  apply: 'Applying',
  test: 'Testing',
  detect: 'Analyzing',
  repair: 'Repairing',
  preview: 'Preview',
  done: 'Done',
  failed: 'Failed',
};

function StatusMark({ status }: { status: StepStatus }) {
  if (status === 'active') return <span className="tl__spinner" aria-label="Running" />;
  if (status === 'success')
    return (
      <span className="tl__mark tl__mark--ok">
        <IconCheck size={10} />
      </span>
    );
  if (status === 'warning')
    return (
      <span className="tl__mark tl__mark--warn">
        <IconAlert size={9} />
      </span>
    );
  if (status === 'failed')
    return (
      <span className="tl__mark tl__mark--err">
        <IconX size={10} />
      </span>
    );
  if (status === 'skipped') return <span className="tl__mark tl__mark--skip">–</span>;
  return <span className="tl__mark tl__mark--idle" />;
}

function LiveElapsed({ startedAt, finishedAt, isActive }: { startedAt?: number; finishedAt?: number; isActive: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isActive || !startedAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive, startedAt, tick]);

  if (!startedAt) return null;
  const end = finishedAt ?? (isActive ? now() : undefined);
  if (!end) return <span className="tl__time mono">0s</span>;
  const dur = end - startedAt;
  return <span className="tl__time mono">{formatDuration(dur)}</span>;
}

/* ------------------------------------------------------------------ */
/* Auto Repair sub-pipeline                                            */
/* ------------------------------------------------------------------ */

const REPAIR_STAGES = ['analyze', 'suggest', 'apply', 'rerun', 'verify'] as const;
const REPAIR_LABELS: Record<string, string> = {
  analyze: 'Analyze',
  suggest: 'Suggest Fix',
  apply: 'Apply Fix',
  rerun: 'Run Again',
  verify: 'Verify',
};

function RepairCard({ repair }: { repair: RepairAttempt }) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`repair repair--${repair.outcome}`}>
      <button className="repair__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="repair__badge">
          <IconWrench size={11} />
        </span>
        <span className="repair__title">
          Auto Repair · <code className="mono">{repair.diagnostic.code}</code>
        </span>
        <span className={`repair__outcome repair__outcome--${repair.outcome}`}>
          {repair.outcome === 'verified'
            ? 'Verified'
            : repair.outcome === 'reverted'
              ? 'Reverted'
              : repair.outcome === 'failed'
                ? 'Failed'
                : 'Running'}
        </span>
      </button>

      {open && (
        <div className="repair__body">
          <p className="repair__error">{repair.diagnostic.message}</p>
          <p className="repair__loc mono">
            {repair.diagnostic.file}:{repair.diagnostic.line}
          </p>

          <ol className="repair__flow">
            {REPAIR_STAGES.map((stage) => {
              const found = repair.stages.find((s) => s.stage === stage);
              const status = found?.status ?? 'pending';
              return (
                <li key={stage} className={`flow flow--${status}`}>
                  <span className="flow__node">
                    {status === 'active' ? (
                      <span className="flow__spin" />
                    ) : status === 'success' ? (
                      <IconCheck size={9} />
                    ) : status === 'failed' ? (
                      <IconX size={9} />
                    ) : (
                      <span className="flow__dot" />
                    )}
                  </span>
                  <span className="flow__label">{REPAIR_LABELS[stage]}</span>
                  {found?.detail && <span className="flow__detail">{found.detail.slice(0, 60)}</span>}
                </li>
              );
            })}
          </ol>

          {repair.analysis && (
            <div className="repair__block">
              <span className="repair__block-label">Analysis</span>
              <p>{repair.analysis}</p>
            </div>
          )}
          {repair.suggestion && (
            <div className="repair__block">
              <span className="repair__block-label">Proposed fix</span>
              <p>{repair.suggestion}</p>
            </div>
          )}
          {repair.outcome === 'reverted' && (
            <p className="repair__note">
              Verification failed — the project was restored to the pre-repair snapshot. Nothing was left in a broken state.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step row                                                            */
/* ------------------------------------------------------------------ */

function StepRow({ step, isLast, run }: { step: AgentStep; isLast: boolean; run: AgentRun }) {
  const [open, setOpen] = useState(step.status === 'active' || step.status === 'failed');
  const Icon = PHASE_ICON[step.phase] ?? IconCode;
  const isActive = step.status === 'active';
  const hasLogs = step.logs.length > 0;
  const isDone = step.status === 'success' || step.status === 'failed' || step.status === 'warning';

  // Auto-open when step becomes active or failed
  useEffect(() => {
    if (isActive || step.status === 'failed') setOpen(true);
  }, [isActive, step.status]);

  // Show relevant files / test counts based on phase
  const extraInfo = (() => {
    if (step.phase === 'inspect' && run.plan) {
      return null;
    }
    if (step.phase === 'test' && run.testResults.length > 0) {
      const passed = run.testResults.filter((r) => r.status === 'passed').length;
      const failed = run.testResults.filter((r) => r.status === 'failed').length;
      return (
        <span className="tl__extra">
          <span className="tl__add">✓ {passed}</span> <span className="tl__del">✗ {failed}</span>
        </span>
      );
    }
    if (step.phase === 'apply' && run.changes.length > 0) {
      return <span className="tl__extra">{run.changes.length} file(s)</span>;
    }
    if (step.phase === 'detect' && run.diagnostics.length > 0) {
      const errs = run.diagnostics.filter((d) => d.severity === 'error').length;
      const warns = run.diagnostics.filter((d) => d.severity === 'warning').length;
      return (
        <span className="tl__extra">
          {errs > 0 && <span className="tl__del">{errs} err</span>} {warns > 0 && <span className="tl__warn">{warns} warn</span>}
        </span>
      );
    }
    return null;
  })();

  return (
    <li className={`tl__step tl__step--${step.status}`}>
      {!isLast && <span className="tl__line" aria-hidden="true" />}
      <div className="tl__icon">
        <StatusMark status={step.status} />
      </div>

      <div className="tl__content">
        <button
          className="tl__row"
          onClick={() => hasLogs && setOpen(!open)}
          disabled={!hasLogs}
          aria-expanded={hasLogs ? open : undefined}
        >
          <Icon size={12} className="tl__phase-icon" />
          <span className="tl__title">{step.title}</span>
          {extraInfo}
          <LiveElapsed startedAt={step.startedAt} finishedAt={step.finishedAt} isActive={isActive} />
          {hasLogs && (
            <span className={`tl__chev ${open ? 'is-open' : ''}`} aria-hidden="true">
              ›
            </span>
          )}
        </button>

        {step.detail && <p className="tl__detail">{step.detail}</p>}

        {isActive && (
          <div className="tl__live-indicator">
            <span className="tl__live-dot" />
            <span className="tl__live-text">Working...</span>
          </div>
        )}

        {open && hasLogs && (
          <pre className="tl__logs mono">
            {step.logs.slice(-40).map((line, i) => (
              <div key={i} className={`tl__log-line ${line.includes('✗') || line.includes('ERROR') || line.includes('Failed') ? 'is-error' : ''} ${line.includes('✓') || line.includes('create') || line.includes('update') ? 'is-success' : ''}`}>
                {line}
              </div>
            ))}
            {step.logs.length > 40 && <div className="tl__log-more">... {step.logs.length - 40} earlier lines hidden</div>}
          </pre>
        )}

        {isDone && step.phase === 'test' && run.testResults.length > 0 && !open && (
          <div className="tl__mini-tests">
            {run.testResults.slice(0, 3).map((t) => (
              <span key={t.id} className={`tl__mini-test tl__mini-test--${t.status}`}>
                {t.status === 'passed' ? '✓' : '✗'} {t.name}
              </span>
            ))}
          </div>
        )}

        {isDone && step.phase === 'apply' && run.changes.length > 0 && !open && (
          <div className="tl__mini-files">
            {run.changes.slice(0, 4).map((c) => (
              <span key={c.path} className="tl__mini-file mono">
                {c.action === 'created' ? 'A' : c.action === 'modified' ? 'M' : 'D'} {c.path}
              </span>
            ))}
            {run.changes.length > 4 && <span className="tl__mini-more">+{run.changes.length - 4} more</span>}
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export function AgentTimeline({ run }: { run: AgentRun }) {
  const [nowTick, setNowTick] = useState(() => now());
  useEffect(() => {
    if (run.status !== 'running') return;
    const id = setInterval(() => setNowTick(now()), 1000);
    return () => clearInterval(id);
  }, [run.status, nowTick]);

  const totalDuration = run.finishedAt ? run.finishedAt - run.startedAt : nowTick - run.startedAt;
  const completedSteps = run.steps.filter((s) => s.status === 'success' || s.status === 'warning' || s.status === 'failed' || s.status === 'skipped').length;
  const totalSteps = run.steps.length;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const activeStep = run.steps.find((s) => s.status === 'active');
  const changed = run.changes.length;
  const additions = run.changes.reduce((n, c) => n + c.additions, 0);
  const deletions = run.changes.reduce((n, c) => n + c.deletions, 0);
  const isRunning = run.status === 'running';

  return (
    <div className={`tl ${isRunning ? 'is-running' : ''}`}>
      <header className="tl__header">
        <span className="tl__header-title">
          <IconBrain size={12} />
          Agent pipeline
          {isRunning && <span className="tl__header-live"><span className="tl__live-dot" /> Live</span>}
        </span>
        <span className={`tl__status tl__status--${run.status}`}>
          {run.status === 'running'
            ? activeStep ? `${PHASE_LABEL[activeStep.phase] ?? activeStep.phase}...` : 'Running'
            : run.status === 'succeeded'
              ? 'Completed'
              : run.status === 'cancelled'
                ? 'Cancelled'
                : 'Failed'}
          {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
        </span>
      </header>

      {isRunning && (
        <div className="tl__progress-wrap">
          <div className="tl__progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="tl__progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="tl__progress-text mono">
            {completedSteps}/{totalSteps} stages · {progress}%
            {activeStep && ` · ${activeStep.title}`}
          </span>
        </div>
      )}

      {isRunning && (
        <div className="tl__working-banner">
          <span className="tl__spinner" />
          <span>Agent is working...</span>
          <span className="tl__working-detail mono">
            {activeStep?.title ?? 'Starting'} — {activeStep?.detail?.slice(0, 80) ?? 'Preparing'}
          </span>
        </div>
      )}

      {run.plan && (
        <div className="tl__plan">
          <p className="tl__plan-summary">{run.plan.summary}</p>
          <ol className="tl__plan-list">
            {run.plan.tasks.map((task) => (
              <li key={task.id}>
                <span className="tl__plan-bullet" aria-hidden="true" />
                <span>{task.title}</span>
                {task.targets.length > 0 && <span className="tl__plan-targets mono">{task.targets.slice(0, 2).join(', ')}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <ul className="tl__steps">
        {run.steps.map((step, i) => (
          <StepRow key={step.id} step={step} isLast={i === run.steps.length - 1} run={run} />
        ))}
      </ul>

      {run.repairs.length > 0 && (
        <div className="tl__repairs">
          <h4 className="tl__repairs-title">Auto Repair {run.repairs.length > 1 ? `(${run.repairs.length} attempts)` : ''}</h4>
          {run.repairs.map((repair) => (
            <RepairCard key={repair.id} repair={repair} />
          ))}
        </div>
      )}

      {changed > 0 && (
        <div className="tl__changes">
          <span className="tl__changes-head">
            {changed} file{changed === 1 ? '' : 's'} changed
            <span className="tl__diff">
              <span className="tl__add">+{additions}</span>
              <span className="tl__del">−{deletions}</span>
            </span>
          </span>
          <ul>
            {run.changes.map((change, i) => (
              <li key={`${change.path}-${i}`} className="tl__change">
                <span className={`tl__action tl__action--${change.action}`}>
                  {change.action === 'created' ? 'A' : change.action === 'modified' ? 'M' : 'D'}
                </span>
                <span className="mono truncate">{change.path}</span>
                <span className="tl__diff">
                  {change.additions > 0 && <span className="tl__add">+{change.additions}</span>}
                  {change.deletions > 0 && <span className="tl__del">−{change.deletions}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.testResults.length > 0 && (
        <div className="tl__tests-summary">
          <span className="tl__changes-head">Tests</span>
          <div className="tl__tests-grid">
            <span className="tl__test-stat tl__test-stat--pass">✓ {run.testResults.filter(r => r.status === 'passed').length} passed</span>
            <span className="tl__test-stat tl__test-stat--fail">✗ {run.testResults.filter(r => r.status === 'failed').length} failed</span>
            <span className="tl__test-stat">{run.testResults.length} total</span>
          </div>
        </div>
      )}

      {run.diagnostics.length > 0 && (
        <div className="tl__diagnostics-summary">
          <span className="tl__changes-head">Diagnostics</span>
          <ul>
            {run.diagnostics.slice(0, 5).map((d) => (
              <li key={d.id} className={`tl__diag tl__diag--${d.severity}`}>
                <span className="mono">{d.code}</span> {d.file}:{d.line} — {d.message.slice(0, 100)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run.status === 'failed' && (
        <div className="tl__error-box">
          <IconAlert size={14} />
          <div>
            <strong>Run failed</strong>
            <p>The agent encountered an error. Check the failed stage logs above for the actual error message and recovery steps. If you saw "Failed to fetch" or network errors, wait 20-30s (Render cold start) and try again.</p>
          </div>
        </div>
      )}
    </div>
  );
}
