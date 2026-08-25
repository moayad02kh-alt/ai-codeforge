import { useState } from 'react';
import type { AgentRun, AgentStep, RepairAttempt, StepStatus } from '../core/types';
import { formatDuration } from '../core/utils';
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
} from './Icons';
import './AgentTimeline.css';

const PHASE_ICON = {
  understand: IconBrain,
  plan: IconList,
  generate: IconCode,
  modify: IconCode,
  test: IconFlask,
  detect: IconBug,
  repair: IconWrench,
  preview: IconEye,
  done: IconCheck,
  failed: IconAlert,
} as const;

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

          {/* Error → Analyze → Suggest → Apply → Run Again → Verify */}
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
              Verification failed — the project was restored to the pre-repair snapshot. Nothing was
              left in a broken state.
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

function StepRow({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = PHASE_ICON[step.phase] ?? IconCode;
  const duration =
    step.startedAt && step.finishedAt ? formatDuration(step.finishedAt - step.startedAt) : null;

  const hasLogs = step.logs.length > 0;

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
          {duration && <span className="tl__time mono">{duration}</span>}
          {hasLogs && (
            <span className={`tl__chev ${open ? 'is-open' : ''}`} aria-hidden="true">
              ›
            </span>
          )}
        </button>

        {step.detail && <p className="tl__detail">{step.detail}</p>}

        {open && hasLogs && (
          <pre className="tl__logs mono">
            {step.logs.map((line, i) => (
              <div key={i} className="tl__log-line">
                {line}
              </div>
            ))}
          </pre>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

export function AgentTimeline({ run }: { run: AgentRun }) {
  const totalDuration = run.finishedAt ? run.finishedAt - run.startedAt : null;
  const changed = run.changes.length;
  const additions = run.changes.reduce((n, c) => n + c.additions, 0);
  const deletions = run.changes.reduce((n, c) => n + c.deletions, 0);

  return (
    <div className="tl">
      <header className="tl__header">
        <span className="tl__header-title">
          <IconBrain size={12} />
          Agent pipeline
        </span>
        <span className={`tl__status tl__status--${run.status}`}>
          {run.status === 'running'
            ? 'Running'
            : run.status === 'succeeded'
              ? 'Completed'
              : run.status === 'cancelled'
                ? 'Cancelled'
                : 'Failed'}
          {totalDuration && ` · ${formatDuration(totalDuration)}`}
        </span>
      </header>

      {run.plan && (
        <div className="tl__plan">
          <p className="tl__plan-summary">{run.plan.summary}</p>
          <ol className="tl__plan-list">
            {run.plan.tasks.map((task) => (
              <li key={task.id}>
                <span className="tl__plan-bullet" aria-hidden="true" />
                <span>{task.title}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ul className="tl__steps">
        {run.steps.map((step, i) => (
          <StepRow key={step.id} step={step} isLast={i === run.steps.length - 1} />
        ))}
      </ul>

      {run.repairs.length > 0 && (
        <div className="tl__repairs">
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
    </div>
  );
}
