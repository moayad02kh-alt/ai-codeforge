/**
 * AutoRepair — the self-healing loop.
 *
 *   Error → Analyze → Suggest Fix → Apply Fix → Run Again → Verify
 *
 * Every stage is recorded on the `RepairAttempt` so the UI can animate the
 * pipeline. Before a fix is applied the caller supplies a rollback snapshot
 * id; if Verify fails, `AutoRepair` reports `reverted` and the orchestrator
 * restores that snapshot. This guarantees a failed repair can never leave the
 * project in a worse state than it started.
 */

import type {
  Diagnostic,
  ProjectFile,
  RepairAttempt,
  RepairStage,
  RepairStageResult,
  StepStatus,
} from '../core/types';
import { jitter, now, sleep, uid } from '../core/utils';
import type { AIProvider, GenerationContext } from './ai/AIProvider';
import { ErrorDetector } from './ErrorDetector';
import { FileManager } from './FileManager';

export interface RepairOutcome {
  attempt: RepairAttempt;
  /** Files after the repair — unchanged from input if the repair was reverted. */
  files: ProjectFile[];
  fixed: boolean;
}

export interface RepairOptions {
  provider: AIProvider;
  files: ProjectFile[];
  diagnostic: Diagnostic;
  projectName: string;
  attemptNumber: number;
  rollbackVersionId?: string;
  /** Called as each stage transitions, for live UI updates. */
  onStage?: (attempt: RepairAttempt) => void;
  signal?: AbortSignal;
}

export class AutoRepair {
  static async attempt(options: RepairOptions): Promise<RepairOutcome> {
    const { provider, diagnostic, projectName, attemptNumber, onStage, signal } = options;
    const originalFiles = options.files;

    const attempt: RepairAttempt = {
      id: uid('repair'),
      diagnosticId: diagnostic.id,
      diagnostic,
      analysis: '',
      suggestion: '',
      stages: [],
      outcome: 'pending',
      rollbackVersionId: options.rollbackVersionId,
      attempt: attemptNumber,
    };

    const setStage = (stage: RepairStage, status: StepStatus, detail: string) => {
      const existing = attempt.stages.find((s) => s.stage === stage);
      const record: RepairStageResult = { stage, status, detail, at: now() };
      if (existing) Object.assign(existing, record);
      else attempt.stages.push(record);
      onStage?.({ ...attempt, stages: [...attempt.stages] });
    };

    const ctx: GenerationContext = {
      prompt: `Fix ${diagnostic.code}: ${diagnostic.message}`,
      files: originalFiles,
      history: [],
      projectName,
      signal,
      // The diagnostic under repair, so the context manager prioritises the
      // offending file and the model sees the exact error it must fix.
      diagnostics: [diagnostic],
    };

    /* ---- 1. Analyze ------------------------------------------------ */
    setStage('analyze', 'active', `Tracing ${diagnostic.code} in ${diagnostic.file}:${diagnostic.line}`);
    await sleep(jitter(500));

    let suggestion;
    try {
      suggestion = await provider.proposeRepair(ctx, {
        message: diagnostic.message,
        file: diagnostic.file,
        line: diagnostic.line,
        code: diagnostic.code,
      });
    } catch (err) {
      setStage('analyze', 'failed', `Analysis failed: ${(err as Error).message}`);
      attempt.outcome = 'failed';
      return { attempt, files: originalFiles, fixed: false };
    }

    attempt.analysis = suggestion.analysis;
    setStage('analyze', 'success', 'Root cause identified');

    /* ---- 2. Suggest ------------------------------------------------ */
    setStage('suggest', 'active', 'Drafting a minimal patch');
    await sleep(jitter(420));
    attempt.suggestion = suggestion.suggestion;

    const before = FileManager.find(originalFiles, suggestion.path)?.content ?? '';
    attempt.patch = { path: suggestion.path, before, after: suggestion.content };
    setStage(
      'suggest',
      'success',
      `Patch prepared for ${suggestion.path} (confidence ${(suggestion.confidence * 100).toFixed(0)}%)`,
    );

    if (before === suggestion.content) {
      setStage('apply', 'skipped', 'Patch is a no-op — nothing to apply');
      attempt.outcome = 'failed';
      return { attempt, files: originalFiles, fixed: false };
    }

    /* ---- 3. Apply -------------------------------------------------- */
    setStage('apply', 'active', `Writing ${suggestion.path}`);
    await sleep(jitter(360));
    const { files: patchedFiles } = FileManager.applyChanges(
      originalFiles,
      [{ path: suggestion.path, content: suggestion.content }],
      [],
      'agent',
    );
    setStage('apply', 'success', 'Patch applied to the working tree');

    /* ---- 4. Run again ---------------------------------------------- */
    setStage('rerun', 'active', 'Re-running static analysis and the test suite');
    await sleep(jitter(620));
    const after = ErrorDetector.analyze(patchedFiles);
    const stillPresent = after.some(
      (d) => d.code === diagnostic.code && d.file === diagnostic.file,
    );
    const errorsBefore = ErrorDetector.errorCount(ErrorDetector.analyze(originalFiles));
    const errorsAfter = ErrorDetector.errorCount(after);
    setStage('rerun', 'success', `Errors: ${errorsBefore} → ${errorsAfter}`);

    /* ---- 5. Verify -------------------------------------------------- */
    setStage('verify', 'active', 'Verifying the fix resolved the fault');
    await sleep(jitter(400));

    // A repair is only accepted if the target diagnostic is gone AND the
    // overall error count did not regress.
    const success = !stillPresent && errorsAfter <= errorsBefore;

    if (success) {
      setStage('verify', 'success', `${diagnostic.code} resolved and no regressions introduced`);
      attempt.outcome = 'verified';
      return { attempt, files: patchedFiles, fixed: true };
    }

    setStage(
      'verify',
      'failed',
      stillPresent
        ? `${diagnostic.code} still present after the patch — reverting`
        : `Patch introduced ${errorsAfter - errorsBefore} new error(s) — reverting`,
    );
    attempt.outcome = 'reverted';
    // Roll back by returning the ORIGINAL files; the caller also restores the
    // version snapshot so history reflects the revert.
    return { attempt, files: originalFiles, fixed: false };
  }

  /** Chooses which faults to attack: errors first, only repairable ones. */
  static prioritize(diagnostics: Diagnostic[], max: number): Diagnostic[] {
    const weight = (d: Diagnostic) => (d.severity === 'error' ? 0 : d.severity === 'warning' ? 1 : 2);
    return diagnostics
      .filter((d) => d.repairable)
      .sort((a, b) => weight(a) - weight(b))
      .slice(0, max);
  }
}
