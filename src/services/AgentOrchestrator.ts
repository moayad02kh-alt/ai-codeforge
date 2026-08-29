/**
 * AgentOrchestrator — drives the full agent pipeline with live transparent progress.
 *
 *   understand → inspect → plan → generate → apply → test → detect → repair → preview → done
 *
 * It owns no UI state. It emits events on the bus and returns the resulting
 * files; the Zustand store projects those events into React state. That
 * separation is what makes it possible to move this loop server-side later:
 * the same events would arrive over SSE instead of in-process.
 *
 * This version adds:
 *  - 10-stage pipeline matching UX requirements
 *  - Live per-file logging (filenames, test counts, diagnostics)
 *  - Real-time elapsed tracking via bus events (not fake animation)
 *  - Robust network error handling for "Failed to fetch"
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
import { ProjectContextManager } from './ai/ProjectContext';
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

/**
 * Convert any thrown value into human-readable display text.
 * UI-serialization only: digs Error instances, `message` / `error` /
 * `detail(s)` fields and nested payloads for the most relevant message.
 * Never alters control flow, retries, or error handling.
 */
function toErrorMessage(err: unknown): string {
  const DIG_KEYS = ['message', 'error', 'detail', 'details'] as const;
  const dig = (o: unknown, depth = 0): string => {
    if (o == null || depth > 3) return '';
    if (typeof o === 'string') {
      const s = o.trim();
      return s && s !== '[object Object]' ? s : '';
    }
    if (o instanceof Error) {
      const m = o.message?.trim();
      if (m && m !== '[object Object]') return m;
      return dig((o as Error & { cause?: unknown }).cause, depth + 1);
    }
    if (typeof o === 'object') {
      for (const key of DIG_KEYS) {
        const found = dig((o as Record<string, unknown>)[key], depth + 1);
        if (found) return found;
      }
    }
    return '';
  };
  const msg = dig(err);
  return msg
    ? msg.length > 300
      ? `${msg.slice(0, 300)}…`
      : msg
    : 'Unknown error — see the run details below for the full log.';
}

const STEP_BLUEPRINT: Array<{ phase: AgentPhase; title: string; description: string }> = [
  { phase: 'understand', title: 'Understanding the request', description: 'Parsing your prompt and detecting intent' },
  { phase: 'inspect', title: 'Inspecting relevant files', description: 'Scanning project context and selecting relevant files' },
  { phase: 'plan', title: 'Planning the work', description: 'Breaking down the task into actionable steps' },
  { phase: 'generate', title: 'Generating code', description: 'Creating new code with the AI model' },
  { phase: 'apply', title: 'Applying file changes', description: 'Writing changes to the project file tree' },
  { phase: 'test', title: 'Running tests', description: 'Executing the test suite to verify behavior' },
  { phase: 'detect', title: 'Detecting errors', description: 'Analyzing code for issues and diagnostics' },
  { phase: 'repair', title: 'Auto Repair', description: 'Automatically fixing detected problems' },
  { phase: 'preview', title: 'Building preview', description: 'Bundling the app for live preview' },
  { phase: 'done', title: 'Completed', description: 'Finalizing the run and preparing results' },
];

export class AgentOrchestrator {
  constructor(private readonly provider: AIProvider) {}

  async execute(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const runId = uid('run');

    const steps: AgentStep[] = STEP_BLUEPRINT.map((s) => ({
      id: uid('step'),
      phase: s.phase,
      title: s.title,
      detail: s.description,
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
      // Also emit console for bottom panel visibility
      bus.emit('console:entry', {
        entry: { id: uid('log'), level: 'system', message: `▶ ${step.title}: ${detail ?? ''}`, at: now(), source: 'agent' },
      });
    };

    const log = (phase: AgentPhase, line: string) => {
      const step = stepFor(phase);
      step.logs.push(line);
      bus.emit('run:log', { runId, stepId: step.id, line });
      bus.emit('run:step', { runId, step: { ...step, logs: [...step.logs] } });
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

    // Live runs answer as soon as the model does; simulated runs keep the
    // working pauses so the pipeline stays legible. Pure pacing — the same
    // stages run either way.
    const pace = (ms: number) => (this.provider.isLive ? Promise.resolve() : sleep(jitter(ms)));

    const ctx: GenerationContext = {
      prompt: input.prompt,
      files: input.files,
      history: input.history,
      projectName: input.projectName,
      signal: input.signal,
      diagnostics: [],
    };

    let files = input.files;
    let message = '';
    let allChanges: FileChangeSummary[] = [];

    try {
      /* ---- 1. Understand ------------------------------------------ */
      begin('understand', `Analyzing: "${input.prompt.slice(0, 80)}${input.prompt.length > 80 ? '...' : ''}"`);
      log('understand', `Prompt received (${input.prompt.length} chars, ${input.files.length} files in context)`);
      await pace(180);
      const intent = await this.provider.classifyIntent(ctx);
      if (aborted()) throw new DOMException('Aborted', 'AbortError');
      log('understand', `Intent detected: ${intent.kind} · domain: ${intent.domain}`);
      log('understand', `Confidence: ${(intent.confidence * 100).toFixed(0)}% · keywords: ${intent.keywords.slice(0, 8).join(', ') || 'none'}`);
      log('understand', `Restatement: ${intent.restatement.slice(0, 120)}`);
      finish('understand', 'success', intent.restatement);

      /* ---- Conversational fast path ------------------------------- *
       * A chat/explain turn is a natural-language answer, not a code
       * change. Call the model once (reuses the provider's single-run
       * cache), return its prose, and skip inspect/test/detect/repair/
       * preview rebuilds. Coding, fix, and mixed turns still run the
       * full pipeline below, so no agent feature is lost. */
      if (intent.kind === 'chat' || intent.kind === 'explain') {
        const isChat = intent.kind === 'chat';
        begin(
          'generate',
          isChat ? 'Answering conversationally' : 'Explaining (no file changes)',
        );
        log('generate', `Provider: ${this.provider.label} (${this.provider.isLive ? 'live' : 'simulated'})`);
        const convResult = await this.provider.generate(ctx, {
          id: uid('plan'),
          summary: isChat ? 'Respond directly; no file changes.' : 'Answer the question; no file changes.',
          intent,
          tasks: [],
          estimatedFiles: 0,
        });
        if (aborted()) throw new DOMException('Aborted', 'AbortError');
        message = convResult.message;
        run.usage = convResult.usage;
        log('generate', `Conversational reply ready (${message.length} chars) — no files modified`);
        finish('generate', 'success', 'Answered without changing files');

        // Mark the code-workflow stages as not applicable.
        for (const phase of ['inspect', 'plan', 'apply', 'test', 'detect', 'repair', 'preview'] as AgentPhase[]) {
          const st = stepFor(phase);
          if (st.status === 'pending') {
            st.status = 'skipped';
            st.detail = 'Not needed for a conversational reply';
            st.finishedAt = now();
            bus.emit('run:step', { runId, step: { ...st, logs: [...st.logs] } });
          }
        }

        begin('done', 'Finalizing reply');
        log('done', 'Conversational turn complete — project left unchanged');
        finish('done', 'success', 'Replied; no files changed');
        run.status = 'succeeded';
        run.phase = 'done';
        run.finishedAt = now();
        bus.emit('run:finished', { run });

        // Keep the current preview as-is (no rebuild needed).
        const previewHtml = CodeRunner.bundle(files, input.entryPath);
        bus.emit('preview:updated', { html: previewHtml });
        return { run, files, message, changes: [], previewHtml };
      }

      /* ---- 2. Inspect --------------------------------------------- */
      // Prior diagnostics boost file ranking for coding turns. Computed here
      // (not earlier) so conversational turns skip the file scan entirely.
      const priorDiagnostics = ErrorDetector.analyze(input.files);
      ctx.diagnostics = priorDiagnostics;

      begin('inspect', 'Scanning project files and building relevant context');
      log('inspect', `Project has ${input.files.length} file(s) total`);
      // Build context to show which files are relevant
      const context = ProjectContextManager.build(input.files, input.prompt, {
        entryPath: input.entryPath,
        diagnostics: priorDiagnostics,
        maxFiles: 30,
        maxTokens: 24000,
      });
      log('inspect', `Selected ${context.files.length} relevant file(s) for model context (~${context.estimatedTokens} tokens)`);
      for (const cf of context.files.slice(0, 10)) {
        await pace(60);
        log('inspect', `· ${cf.path} (${cf.truncated ? 'truncated' : 'full'} · score ${cf.score})`);
      }
      if (context.files.length > 10) {
        log('inspect', `· ... and ${context.files.length - 10} more`);
      }
      if (context.omitted.length) {
        log('inspect', `${context.omitted.length} file(s) omitted from context (available via inspect_file): ${context.omitted.slice(0, 3).map(o => o.path).join(', ')}${context.omitted.length > 3 ? '...' : ''}`);
      }
      if (priorDiagnostics.length) {
        log('inspect', `${priorDiagnostics.length} prior diagnostic(s) found, boosting those files`);
        for (const d of priorDiagnostics.slice(0, 3)) {
          log('inspect', `  ${d.severity}: ${d.code} in ${d.file}:${d.line}`);
        }
      }
      await pace(200);
      finish('inspect', 'success', `${context.files.length} files selected · ${context.estimatedTokens} tokens`);

      /* ---- 3. Plan ------------------------------------------------- */
      begin('plan', 'Decomposing the work into tasks');
      const plan = await this.provider.createPlan(ctx, intent);
      if (aborted()) throw new DOMException('Aborted', 'AbortError');
      run.plan = plan;
      log('plan', `Plan: ${plan.summary.slice(0, 140)}`);
      for (const task of plan.tasks) {
        await pace(80);
        log('plan', `· ${task.title} ${task.targets.length ? `→ ${task.targets.join(', ')}` : ''}`);
      }
      bus.emit('run:plan', { runId, plan });
      finish('plan', 'success', `${plan.tasks.length} tasks · ~${plan.estimatedFiles} files`);

      /* ---- 4. Generate --------------------------------------------- */
      const isCreate = intent.kind === 'create-project';
      const genStep = stepFor('generate');
      genStep.title = isCreate ? 'Generating code' : 'Generating code changes';
      begin('generate', isCreate ? 'Writing project files with AI model' : 'Generating targeted edits with AI model');
      log('generate', `Provider: ${this.provider.label} (${this.provider.isLive ? 'live' : 'simulated'})`);
      log('generate', `Calling model for ${intent.kind}...`);

      let result;
      try {
        result = await this.provider.generate(ctx, plan);
      } catch (err) {
        const e = err as Error & { code?: string; status?: number };
        // Handle network / provider errors with clear messaging
        if (e.code === 'NETWORK_ERROR' || e.message?.toLowerCase().includes('failed to fetch') || e.message?.includes('Cannot reach AI backend')) {
          log('generate', `⚠ Network error: ${e.message.slice(0, 200)}`);
          log('generate', `Attempting fallback handling...`);
          throw new Error(
            `Agent connection failed: ${e.message}. ` +
              `This usually means the backend is waking up (Render cold start) or is unreachable. ` +
              `Please wait 20s and try again, or continue in simulated mode.`,
          );
        }
        if (e.code === 'PROVIDER_NOT_CONFIGURED') {
          log('generate', `⚠ Provider not configured: ${e.message}`);
          throw new Error(
            `Live provider not configured: ${e.message}. ` +
              `The app will use simulated mode. Set an API key to enable live AI.`,
          );
        }
        throw err;
      }

      if (aborted()) throw new DOMException('Aborted', 'AbortError');

      log('generate', `Model returned ${result.files.length} file(s), ${result.deletions.length} deletion(s)`);
      for (const f of result.files) {
        await pace(90);
        const action = FileManager.find(files, f.path) ? 'update' : 'create';
        log('generate', `${action === 'create' ? '✏️ create' : '📝 update'} ${f.path}${f.rationale ? ` — ${f.rationale.slice(0, 60)}` : ''}`);
      }
      if (result.deletions.length) {
        for (const del of result.deletions) {
          log('generate', `🗑 delete ${del}`);
        }
      }

      /* ---- 5. Apply ------------------------------------------------ */
      begin('apply', 'Writing changes to the project file tree');
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

      if (allChanges.length === 0) {
        log('apply', 'No file changes to apply');
      } else {
        for (const ch of allChanges) {
          await pace(70);
          log('apply', `${ch.action === 'created' ? 'A' : ch.action === 'modified' ? 'M' : 'D'} ${ch.path} (+${ch.additions} -${ch.deletions})`);
        }
      }

      bus.emit('run:changes', { runId, changes: allChanges });
      bus.emit('files:changed', { projectId: input.projectId });
      finish(
        'apply',
        allChanges.length ? 'success' : 'warning',
        allChanges.length ? `${allChanges.length} file(s) written` : 'No files changed',
      );
      // Also finish generate as success
      finish(
        'generate',
        allChanges.length ? 'success' : 'warning',
        allChanges.length ? `${allChanges.length} file(s) generated` : 'No files generated',
      );

      /* ---- 6. Test -------------------------------------------------- */
      let testResults: TestResult[] = [];
      if (input.settings.runTestsAfterGeneration) {
        begin('test', 'Executing the project test suite');
        log('test', `$ npm run test (simulated in browser)`);
        log('test', `Running ${files.filter(f => f.path.includes('test')).length} test file(s)...`);
        testResults = await CodeRunner.runTests(files);
        if (aborted()) throw new DOMException('Aborted', 'AbortError');
        const passed = testResults.filter((t) => t.status === 'passed').length;
        const failed = testResults.filter((t) => t.status === 'failed').length;
        const skipped = testResults.filter((t) => t.status === 'skipped').length;
        for (const t of testResults) {
          const icon = t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : '○';
          log('test', `${icon} ${t.suite} › ${t.name} (${t.durationMs}ms)${t.message ? ` — ${t.message.slice(0, 80)}` : ''}`);
        }
        run.testResults = testResults;
        bus.emit('run:tests', { runId, results: testResults });
        finish(
          'test',
          failed > 0 ? 'failed' : 'success',
          `${passed} passed · ${failed} failed · ${skipped} skipped · ${testResults.length} total`,
        );
      } else {
        finish('test', 'skipped', 'Tests disabled in settings');
      }

      /* ---- 7. Detect ------------------------------------------------ */
      begin('detect', 'Running static analysis for errors and warnings');
      await pace(250);
      let diagnostics: Diagnostic[] = ErrorDetector.analyze(files);
      const errCount = ErrorDetector.errorCount(diagnostics);
      const warnCount = ErrorDetector.warningCount(diagnostics);
      if (!diagnostics.length) {
        log('detect', '✓ No issues found — code looks clean');
      } else {
        log('detect', `Found ${errCount} error(s) and ${warnCount} warning(s)`);
        for (const d of diagnostics.slice(0, 8)) {
          const level = d.severity === 'error' ? 'ERROR' : d.severity === 'warning' ? 'WARN' : 'INFO';
          log('detect', `${level} ${d.code} ${d.file}:${d.line}:${d.column} — ${d.message}${d.repairable ? ' (repairable)' : ''}`);
        }
        if (diagnostics.length > 8) {
          log('detect', `... and ${diagnostics.length - 8} more diagnostics`);
        }
      }
      run.diagnostics = diagnostics;
      bus.emit('run:diagnostics', { runId, diagnostics });
      finish(
        'detect',
        errCount > 0 ? 'failed' : warnCount > 0 ? 'warning' : 'success',
        `${errCount} error(s) · ${warnCount} warning(s)`,
      );

      /* ---- 8. Auto Repair ------------------------------------------- */
      const repairable = AutoRepair.prioritize(
        diagnostics.filter((d) => d.severity === 'error'),
        input.settings.maxRepairAttempts,
      );

      if (input.settings.autoRepair && repairable.length > 0) {
        begin('repair', `Attempting to fix ${repairable.length} fault(s) automatically`);
        let fixedCount = 0;

        for (const [i, diagnostic] of repairable.entries()) {
          if (aborted()) break;
          log('repair', `Attempt ${i + 1}/${repairable.length} — ${diagnostic.code} in ${diagnostic.file}:${diagnostic.line}`);
          log('repair', `  Error: ${diagnostic.message}`);

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
              log('repair', `  ✓ Fixed ${patch.path}, verified`);
            }
            files = outcome.files;
            bus.emit('files:changed', { projectId: input.projectId });
          } else {
            log('repair', `  ✗ Fix failed — project restored to pre-repair snapshot`);
            log('repair', `  Reason: ${outcome.attempt.analysis.slice(0, 120)}`);
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
          log('repair', 'Re-running tests after repair...');
          const rerun = await CodeRunner.runTests(files);
          run.testResults = rerun;
          const p = rerun.filter(r => r.status === 'passed').length;
          const f = rerun.filter(r => r.status === 'failed').length;
          log('repair', `Tests after repair: ${p} passed, ${f} failed`);
          bus.emit('run:tests', { runId, results: rerun });
        }
      } else {
        finish(
          'repair',
          'skipped',
          !input.settings.autoRepair ? 'Auto Repair disabled in settings' : 'No repairable errors found',
        );
      }

      /* ---- 9. Preview ----------------------------------------------- */
      begin('preview', 'Bundling the app for live preview');
      log('preview', `Entry: ${input.entryPath}, ${files.length} files`);
      const runResult = await CodeRunner.run(files, input.entryPath);
      for (const entry of runResult.console) {
        bus.emit('console:entry', { entry });
        if (entry.level === 'error') {
          log('preview', `Console error: ${entry.message.slice(0, 120)}`);
        }
      }
      const previewHtml = runResult.previewHtml ?? CodeRunner.bundle(files, input.entryPath);
      log('preview', `Preview bundled (${Math.round(previewHtml.length / 1024)} KB)`);
      bus.emit('preview:updated', { html: previewHtml });
      bus.emit('runner:result', { result: runResult });
      finish('preview', runResult.status === 'success' ? 'success' : 'warning', 'Preview ready and updated');

      /* ---- 10. Done -------------------------------------------------- */
      begin('done', 'Finalizing run');
      log('done', `Run completed: ${allChanges.length} file(s) changed, ${run.testResults.length} tests, ${ErrorDetector.errorCount(run.diagnostics)} errors`);
      if (run.usage) {
        log('done', `Tokens: ${run.usage.promptTokens} prompt + ${run.usage.completionTokens} completion`);
      }
      finish('done', 'success', 'Agent run completed successfully');

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
        active.detail = isAbort ? 'Cancelled by user' : toErrorMessage(err).slice(0, 200);
        // Add error log to active step
        active.logs.push(`✗ Failed: ${toErrorMessage(err)}`);
        bus.emit('run:step', { runId, step: { ...active, logs: [...active.logs] } });
      }
      // Mark remaining pending steps as skipped if abort, or keep pending
      if (!isAbort) {
        for (const s of steps) {
          if (s.status === 'pending') {
            s.status = 'skipped';
            bus.emit('run:step', { runId, step: { ...s, logs: [...s.logs] } });
          }
        }
      }
      run.status = isAbort ? 'cancelled' : 'failed';
      run.phase = 'failed';
      run.finishedAt = now();
      bus.emit('run:finished', { run });
      bus.emit('console:entry', {
        entry: {
          id: uid('log'),
          level: 'error',
          message: isAbort ? 'Run cancelled by user' : `Run failed: ${toErrorMessage(err)}`,
          at: now(),
          source: 'agent',
        },
      });

      return {
        run,
        files,
        message: isAbort
          ? 'Run cancelled. Any files already written have been kept — use Version History to roll back.'
          : `The run failed: ${toErrorMessage(err)}\n\n` +
            `**What to do:**\n` +
            `- If you saw "Failed to fetch" or "Cannot reach AI backend", the server may be waking up (Render cold start takes 20-30s). Wait and try again.\n` +
            `- If you're in simulated mode, try a more specific prompt.\n` +
            `- Check the console for details and use Version History to revert if needed.`,
        changes: allChanges,
        previewHtml: CodeRunner.bundle(files, input.entryPath),
      };
    }
  }
}
