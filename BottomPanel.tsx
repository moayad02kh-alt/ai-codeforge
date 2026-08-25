import { useEffect, useRef } from 'react';
import type { BottomTab } from '../state/store';
import { formatDuration, formatRelativeTime, formatTime } from '../core/utils';
import { VersionManager } from '../services/VersionManager';
import { selectProjectVersions, useStore } from '../state/store';
import {
  IconAlert,
  IconBug,
  IconCheck,
  IconChevron,
  IconFlask,
  IconHistory,
  IconRevert,
  IconTerminal,
  IconTrash,
  IconX,
} from './Icons';
import './BottomPanel.css';

const TABS: Array<{ id: BottomTab; label: string; Icon: typeof IconTerminal }> = [
  { id: 'console', label: 'Console', Icon: IconTerminal },
  { id: 'tests', label: 'Tests', Icon: IconFlask },
  { id: 'problems', label: 'Problems', Icon: IconBug },
  { id: 'history', label: 'History', Icon: IconHistory },
];

export function BottomPanel() {
  const open = useStore((s) => s.bottomOpen);
  const tab = useStore((s) => s.bottomTab);
  const consoleEntries = useStore((s) => s.consoleEntries);
  const testResults = useStore((s) => s.testResults);
  const diagnostics = useStore((s) => s.diagnostics);
  const versions = useStore(selectProjectVersions);

  const setBottomTab = useStore((s) => s.setBottomTab);
  const toggleBottom = useStore((s) => s.toggleBottom);
  const clearConsole = useStore((s) => s.clearConsole);
  const runTests = useStore((s) => s.runTests);
  const revertToVersion = useStore((s) => s.revertToVersion);
  const openFile = useStore((s) => s.openFile);

  const consoleEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tab === 'console') consoleEndRef.current?.scrollIntoView({ block: 'end' });
  }, [consoleEntries, tab]);

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const failedTests = testResults.filter((t) => t.status === 'failed').length;
  const passedTests = testResults.filter((t) => t.status === 'passed').length;

  const counts: Record<BottomTab, number> = {
    console: consoleEntries.length,
    tests: testResults.length,
    problems: diagnostics.length,
    history: versions.length,
  };

  return (
    <section className={`bottom ${open ? 'is-open' : ''}`} aria-label="Diagnostics">
      <header className="bottom__bar">
        <nav className="bottom__tabs" role="tablist">
          {TABS.map(({ id, label, Icon }) => {
            const isActive = open && tab === id;
            const badge = counts[id];
            const isBad = (id === 'problems' && errorCount > 0) || (id === 'tests' && failedTests > 0);
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                className={`btab ${isActive ? 'is-active' : ''}`}
                onClick={() => (open && tab === id ? toggleBottom(false) : setBottomTab(id))}
              >
                <Icon size={12} />
                <span>{label}</span>
                {badge > 0 && <span className={`btab__badge ${isBad ? 'is-bad' : ''}`}>{badge}</span>}
              </button>
            );
          })}
        </nav>

        <div className="bottom__bar-right">
          {open && tab === 'console' && (
            <button className="bottom__action" onClick={clearConsole} title="Clear console">
              <IconTrash size={12} />
            </button>
          )}
          {open && tab === 'tests' && (
            <button className="bottom__action bottom__action--text" onClick={runTests}>
              Run tests
            </button>
          )}
          <button
            className="bottom__action"
            onClick={() => toggleBottom()}
            aria-label={open ? 'Collapse panel' : 'Expand panel'}
            title={open ? 'Collapse' : 'Expand'}
          >
            <IconChevron size={13} className={`bottom__chev ${open ? 'is-open' : ''}`} />
          </button>
        </div>
      </header>

      {open && (
        <div className="bottom__body">
          {/* ---------------- Console ---------------- */}
          {tab === 'console' && (
            <div className="console">
              {consoleEntries.length === 0 ? (
                <p className="bottom__empty">
                  No output yet. Press <strong>Run</strong> or send the agent a request.
                </p>
              ) : (
                <>
                  {consoleEntries.map((entry) => (
                    <div className={`cline cline--${entry.level}`} key={entry.id}>
                      <span className="cline__time mono">{formatTime(entry.at)}</span>
                      <span className={`cline__tag cline__tag--${entry.level}`}>
                        {entry.level === 'system' ? 'sys' : entry.level}
                      </span>
                      <span className="cline__msg mono">{entry.message}</span>
                    </div>
                  ))}
                  <div ref={consoleEndRef} />
                </>
              )}
            </div>
          )}

          {/* ---------------- Tests ---------------- */}
          {tab === 'tests' && (
            <div className="tests">
              {testResults.length === 0 ? (
                <p className="bottom__empty">
                  No test run yet. Press <strong>Run tests</strong> above.
                </p>
              ) : (
                <>
                  <div className="tests__summary">
                    <span className="pill pill--ok">
                      <IconCheck size={10} /> {passedTests} passed
                    </span>
                    {failedTests > 0 && (
                      <span className="pill pill--err">
                        <IconX size={10} /> {failedTests} failed
                      </span>
                    )}
                    <span className="tests__note">
                      Simulated run — connect a sandbox backend to execute real tests.
                    </span>
                  </div>
                  <ul className="tests__list">
                    {testResults.map((t) => (
                      <li key={t.id} className={`trow trow--${t.status}`}>
                        <span className={`trow__mark trow__mark--${t.status}`}>
                          {t.status === 'passed' ? (
                            <IconCheck size={9} />
                          ) : t.status === 'failed' ? (
                            <IconX size={9} />
                          ) : (
                            '–'
                          )}
                        </span>
                        <span className="trow__suite mono">{t.suite}</span>
                        <span className="trow__sep">›</span>
                        <span className="trow__name">{t.name}</span>
                        <span className="trow__time mono">{formatDuration(t.durationMs)}</span>
                        {t.message && <p className="trow__msg">{t.message}</p>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* ---------------- Problems ---------------- */}
          {tab === 'problems' && (
            <div className="problems">
              {diagnostics.length === 0 ? (
                <p className="bottom__empty">
                  <IconCheck size={13} /> No problems detected in this project.
                </p>
              ) : (
                <>
                  <div className="problems__summary">
                    {errorCount > 0 && (
                      <span className="pill pill--err">
                        <IconAlert size={10} /> {errorCount} error{errorCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {warnCount > 0 && (
                      <span className="pill pill--warn">
                        <IconAlert size={10} /> {warnCount} warning{warnCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <ul className="problems__list">
                    {diagnostics.map((d) => (
                      <li key={d.id}>
                        <button className={`prow prow--${d.severity}`} onClick={() => openFile(d.file)}>
                          <span className={`prow__dot prow__dot--${d.severity}`} />
                          <span className="prow__code mono">{d.code}</span>
                          <span className="prow__msg">{d.message}</span>
                          <span className="prow__loc mono">
                            {d.file}:{d.line}:{d.column}
                          </span>
                          {d.repairable && <span className="prow__fixable">Auto-fixable</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* ---------------- Version history ---------------- */}
          {tab === 'history' && (
            <div className="history">
              {versions.length === 0 ? (
                <p className="bottom__empty">
                  No versions yet. Every agent run and manual save creates a restore point.
                </p>
              ) : (
                <ul className="history__list">
                  {versions.map((v, i) => {
                    const totals = VersionManager.changeTotals(v);
                    return (
                      <li key={v.id} className="vrow">
                        <span className={`vrow__origin vrow__origin--${v.origin}`}>
                          {v.origin === 'auto-repair'
                            ? 'Repair'
                            : v.origin === 'agent'
                              ? 'Agent'
                              : v.origin === 'user'
                                ? 'Manual'
                                : v.origin === 'revert'
                                  ? 'Revert'
                                  : 'Auto'}
                        </span>
                        <div className="vrow__body">
                          <span className="vrow__label truncate">{v.label}</span>
                          <span className="vrow__desc truncate">{v.description}</span>
                        </div>
                        <span className="vrow__stats">
                          {totals.additions > 0 && (
                            <span className="tl__add">+{totals.additions}</span>
                          )}
                          {totals.deletions > 0 && (
                            <span className="tl__del">−{totals.deletions}</span>
                          )}
                        </span>
                        <span className="vrow__time">{formatRelativeTime(v.createdAt)}</span>
                        <button
                          className="vrow__revert"
                          onClick={() => {
                            if (window.confirm(`Revert the project to "${v.label}"?`))
                              revertToVersion(v.id);
                          }}
                          disabled={i === 0}
                          title={i === 0 ? 'This is the current state' : `Revert to ${v.label}`}
                        >
                          <IconRevert size={11} />
                          Revert
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
