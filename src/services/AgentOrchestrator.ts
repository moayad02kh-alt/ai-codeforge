/**
 * AgentOrchestrator — drives the full agent pipeline.
 *
 *   understand → plan → generate/modify → test → detect → repair → preview
 *
 * It owns no UI state. It emits events on the bus and returns the resulting
 * files; the Zustand store projects those events into React state. That
 * separation is what makes it possible to move this loop server-side later:
 * the same events would arrive over SSE instead of in-process.
 *
 * NOTE: with the default `MockAIProvider` no real inference happens and tests
 * are simulated. The UI communicates this explicitly.
 */

import { bus } from '../core/events';
import type {
  AgentPhase,
  AgentRun,
  AgentSettings,
  AgentStep,
  Diagnostic,
  FileChangeSummary,
  ProjectFile,
  StepStatus,
  TestResult,
} from '../core/types';
import { jitter, now, sleep, uid } from '../core/utils';
import type { AIProvider, GenerationContext } from './ai/AIProvider';
import { AutoRepair } from './AutoRepair';
import { CodeRunner } from './CodeRunner';
import { ErrorDetector } from './ErrorDetector';
import { FileManager } from './FileManager';

export interface OrchestratorInput {
  projectId: string;
  projectName: string;
  prompt: string;
  files: ProjectFile[];
  entryPath: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  settings: AgentSettings;
  /** Snapshot id captured before the run — the rollback target. */
  rollbackVersionId?: string;
  signal?: AbortSignal;
}

export interface OrchestratorOutput {
  run: AgentRun;
  files: ProjectFile[];
  message: string;
  changes: FileChangeSummary[];
  previewHtml: string;
}

const STEP_BLUEPRINT: Array<{ phase: AgentPhase; title: string }> = [
  { phase: 'understand', title: 'Understand the request' },
  { phase: 'plan', title: 'Plan the work' },
  { phase: 'generate', title: 'Generate code' },
  { phase: 'test', title: 'Run tests' },
  { phase: 'detect', title: 'Detect errors' },
  { phase: 'repair', title: 'Auto Repair' },
  { phase: 'preview', title: 'Build preview' },
];

export class AgentOrchestrator {
  constructor(private readonly provider: AIProvider) {}

  async execute(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const runId = uid('run');

    const steps: AgentStep[] = STEP_BLUEPRINT.map((s) => ({
      id: uid('step'),
      phase: s.phase,
      title: s.title,
      status: 'pending' as StepStatus,
      logs: [],
    }));

    const run: AgentRun = {
      id: runId,
      projectId: input.projectId,
      prompt: input.prompt,
      status: 'running',
      phase: 'understand',
      steps,
      changes: [],
      testResults: [],
      diagnostics: [],
      repairs: [],
      startedAt: now(),
    };

    bus.emit('run:started', { run });

    const stepFor = (phase: AgentPhase) => steps.find((s) => s.phase === phase)!;

    const begin = (phase: AgentPhase, detail?: string) => {
      const step = stepFor(phase);
      step.status = 'active';
      step.startedAt = now();
      if (detail) step.detail = detail;
      run.phase = phase;
      bus.emit('run:step', { runId, step: { ...step, logs: [...step.logs] } });
    };

    const log = (phase: AgentPhase, line: string) => {
      const step = stepFor(phase);
      step.logs.push(line);
      bus.emit('run:log', { runId, stepId: step.id, line });
      bus.emit('console:entry', {
        entry: { id: uid('log'), level: 'system', message: line, at: now(), source: 'agent' },
      });
    };

    const finish = (phase: AgentPhase, status: StepStatus, detail?: string) => {
      const step = stepFor(phase);
      step.status = status;
      step.finishedAt = now();
      if (detail) step.detail = detail;
      bus.emit('run:step', { runId, step: { ...step, logs: [...step.logs] } });
    };

    const aborted = () => input.signal?.aborted === true;

    // Diagnostics the project already carries when the turn starts. A model
    // asked to modify a broken project needs to see what is broken, and the
    // Project Context manager boosts the ranking of the files these point at
    // so the relevant code is actually included in the budget.
    const priorDiagnostics = ErrorDetector.analyze(input.files);

    const ctx: GenerationContext = {
      prompt: input.prompt,
      files: input.files,
      history: input.history,
      projectName: input.projectName,
      signal: input.signal,
      diagnostics: priorDiagnostics,
    };

    let files = input.files;
    let message = '';
    let allChanges: FileChangeSummary[] = [];

    try {
      /* ---- 1. Understand ------------------------------------------ */
      begin('understand', 'Parsing intent and extracting requirements');
      log('understand', `Prompt received (${input.prompt.length} chars)`);
      const intent = await this.provider.classifyIntent(ctx);
      if (aborted()) throw new DOMException('Aborted', 'AbortError');
      log('understand', `Intent: ${intent.kind} · domain: ${intent.domain}`);
      log('understand', `Confidence: ${(intent.confidence * 100).toFixed(0)}%`);
      log('understand', `Keywords: ${intent.keywords.slice(0, 8).join(', ') || 'none'}`);
      finish('understand', 'success', intent.restatement);

      /* ---- 2. Plan ------------------------------------------------- */
      begin('plan', 'Decomposing the work into tasks');
      const plan = await this.provider.createPlan(ctx, intent);
      if (aborted()) throw new DOMException('Aborted', 'AbortError');
      run.plan = plan;
      for (const task of plan.tasks) log('plan', `· ${task.title}`);
      bus.emit('run:plan', { runId, plan });
      finish('plan', 'success', `${plan.tasks.length} tasks · ~${plan.estimatedFiles} files`);

      /* ---- 3. Generate / modify ------------------------------------ */
      const isCreate = intent.kind === 'create-project';
      const genStep = stepFor('generate');
      genStep.title = isCreate ? 'Generate code' : 'Modify existing files';
      begin('generate', isCreate ? 'Writing project files' : 'Applying targeted edits');

      const result = await this.provider.generate(ctx, plan);
      if (aborted()) throw new DOMException('Aborted', 'AbortError');

      // Stream per-file progress so the timeline feels alive.
      for (const f of result.files) {
        await sleep(jitter(130));
        log('generate', `${FileManager.find(files, f.path) ? 'modified' : 'created'} ${f.path}`);
      }

      const applied = FileManager.applyChanges(
        files,
        result.files.map((f) => ({ path: f.path, content: f.content })),
        result.deletions,
        'agent',
      );
      files = applied.files;
      allChanges = applied.changes;
      run.changes = allChanges;
      message = result.message;
      run.usage = result.usage;

      bus.emit('run:changes', { runId, changes: allChanges });
      bus.emit('files:changed', { projectId: input.projectId });
      finish(
        'generate',
        allChanges.length ? 'success' : 'warning',
        allChanges.length ? `${allChanges.length} file(s) written` : 'No files changed',
      );

      /* ---- 4. Test -------------------------------------------------- */
      let testResults: TestResult[] = [];
      if (input.settings.runTestsAfterGeneration) {
        begin('test', 'Executing the project test suite');
        log('test', '$ npm run test');
        testResults = await CodeRunner.runTests(files);
        if (aborted()) throw new DOMException('Aborted', 'AbortError');
        const passed = testResults.filter((t) => t.status === 'passed').length;
        const failed = testResults.filter((t) => t.status === 'failed').length;
        for (const t of testResults) {
          log('test', `${t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : '○'} ${t.suite} › ${t.name}`);
        }
        run.testResults = testResults;
        bus.emit('run:tests', { runId, results: testResults });
        finish(
          'test',
          failed > 0 ? 'failed' : 'success',
          `${passed} passed · ${failed} failed · ${testResults.length} total`,
        );
      } else {
        finish('test', 'skipped', 'Disabled in settings');
      }

      /* ---- 5. Detect ------------------------------------------------ */
      begin('detect', 'Running static analysis');
      await sleep(jitter(320));
      let diagnostics: Diagnostic[] = ErrorDetector.analyze(files);
      const errCount = ErrorDetector.errorCount(diagnostics);
      const warnCount = ErrorDetector.warningCount(diagnostics);
      for (const d of diagnostics.slice(0, 6)) {
        log('detect', `${d.severity.toUpperCase()} ${d.code} ${d.file}:${d.line} — ${d.message}`);
      }
      if (!diagnostics.length) log('detect', 'No issues found');
      run.diagnostics = diagnostics;
      bus.emit('run:diagnostics', { runId, diagnostics });
      finish(
        'detect',
        errCount > 0 ? 'failed' : warnCount > 0 ? 'warning' : 'success',
        `${errCount} error(s) · ${warnCount} warning(s)`,
      );

      /* ---- 6. Auto Repair ------------------------------------------- */
      const repairable = AutoRepair.prioritize(
        diagnostics.filter((d) => d.severity === 'error'),
        input.settings.maxRepairAttempts,
      );

      if (input.settings.autoRepair && repairable.length > 0) {
        begin('repair', `Attempting to fix ${repairable.length} fault(s)`);
        let fixedCount = 0;

        for (const [i, diagnostic] of repairable.entries()) {
          if (aborted()) break;
          log('repair', `Attempt ${i + 1}/${repairable.length} — ${diagnostic.code} in ${diagnostic.file}`);

          const outcome = await AutoRepair.attempt({
            provider: this.provider,
            files,
            diagnostic,
            projectName: input.projectName,
            attemptNumber: i + 1,
            rollbackVersionId: input.rollbackVersionId,
            signal: input.signal,
            onStage: (attempt) => {
              const idx = run.repairs.findIndex((r) => r.id === attempt.id);
              if (idx === -1) run.repairs.push(attempt);
              else run.repairs[idx] = attempt;
              bus.emit('run:repair', { runId, repair: attempt });
            },
          });

          for (const stage of outcome.attempt.stages) {
            log('repair', `  ${stage.stage}: ${stage.status} — ${stage.detail}`);
          }

          if (outcome.fixed) {
            fixedCount += 1;
            const patch = outcome.attempt.patch;
            if (patch) {
              const stats = FileManager.applyChanges(files, [{ path: patch.path, content: patch.after }]);
              allChanges = [...allChanges, ...stats.changes];
            }
            files = outcome.files;
            bus.emit('files:changed', { projectId: input.projectId });
          } else {
            log('repair', `  reverted — project restored to the pre-repair snapshot`);
          }
        }

        diagnostics = ErrorDetector.analyze(files);
        run.diagnostics = diagnostics;
        bus.emit('run:diagnostics', { runId, diagnostics });

        const remaining = ErrorDetector.errorCount(diagnostics);
        finish(
          'repair',
          remaining === 0 ? 'success' : fixedCount > 0 ? 'warning' : 'failed',
          `${fixedCount} fixed · ${remaining} remaining`,
        );

        if (fixedCount > 0) {
          message += `\n\n**Auto Repair** fixed ${fixedCount} issue${fixedCount === 1 ? '' : 's'} automatically${remaining ? ` (${remaining} still open)` : ' and verified the result'}.`;
        }

        // Re-run tests after a successful repair to confirm green.
        if (fixedCount > 0 && input.settings.runTestsAfterGeneration) {
          const rerun = await CodeRunner.runTests(files);
          run.testResults = rerun;
          bus.emit('run:tests', { runId, results: rerun });
        }
      } else {
        finish(
          'repair',
          'skipped',
          !input.settings.autoRepair ? 'Auto Repair disabled' : 'No repairable errors',
        );
      }

      /* ---- 7. Preview ----------------------------------------------- */
      begin('preview', 'Bundling the sandbox document');
      const runResult = await CodeRunner.run(files, input.entryPath);
      for (const entry of runResult.console) bus.emit('console:entry', { entry });
      const previewHtml = runResult.previewHtml ?? CodeRunner.bundle(files, input.entryPath);
      bus.emit('preview:updated', { html: previewHtml });
      bus.emit('runner:result', { result: runResult });
      finish('preview', runResult.status === 'success' ? 'success' : 'warning', 'Preview ready');

      run.status = 'succeeded';
      run.phase = 'done';
      run.finishedAt = now();
      bus.emit('run:finished', { run });

      return { run, files, message, changes: allChanges, previewHtml };
    } catch (err) {
      const isAbort = (err as Error).name === 'AbortError';
      const active = steps.find((s) => s.status === 'active');
      if (active) {
        active.status = isAbort ? 'skipped' : 'failed';
        active.finishedAt = now();
        active.detail = isAbort ? 'Cancelled by user' : (err as Error).message;
        bus.emit('run:step', { runId, step: { ...active, logs: [...active.logs] } });
      }
      run.status = isAbort ? 'cancelled' : 'failed';
      run.phase = 'failed';
      run.finishedAt = now();
      bus.emit('run:finished', { run });

      return {
        run,
        files,
        message: isAbort
          ? 'Run cancelled. Any files already written have been kept — use Version History to roll back.'
          : `The run failed: ${(err as Error).message}`,
        changes: allChanges,
        previewHtml: CodeRunner.bundle(files, input.entryPath),
      };
    }
  }
}
