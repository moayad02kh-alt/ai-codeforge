/**
 * VersionManager — immutable snapshot history with one-click revert.
 *
 * The Auto Repair loop depends on this: before any risky mutation the
 * orchestrator takes a snapshot, and if verification fails the project is
 * restored to that exact state.
 *
 * Snapshots store full file contents. That is memory-cheap for prototype-sized
 * projects and completely avoids patch-application bugs. A production backend
 * would swap this for content-addressed storage or real git objects while
 * keeping the same API.
 */

import type {
  FileChangeSummary,
  ProjectFile,
  VersionOrigin,
  VersionSnapshot,
} from '../core/types';
import { deepClone, now, uid } from '../core/utils';

export interface CreateSnapshotInput {
  projectId: string;
  label: string;
  description: string;
  origin: VersionOrigin;
  files: ProjectFile[];
  changes?: FileChangeSummary[];
  runId?: string;
}

export class VersionManager {
  static snapshot(input: CreateSnapshotInput): VersionSnapshot {
    return {
      id: uid('ver'),
      projectId: input.projectId,
      label: input.label,
      description: input.description,
      origin: input.origin,
      createdAt: now(),
      files: deepClone(input.files),
      changes: input.changes ?? [],
      runId: input.runId,
    };
  }

  /** Newest first, capped so long sessions don't grow unbounded. */
  static append(
    history: VersionSnapshot[],
    snapshot: VersionSnapshot,
    limit = 60,
  ): VersionSnapshot[] {
    return [snapshot, ...history].slice(0, limit);
  }

  static get(history: VersionSnapshot[], id: string): VersionSnapshot | undefined {
    return history.find((v) => v.id === id);
  }

  /** Returns the file set to restore, deep-cloned so history stays immutable. */
  static restore(history: VersionSnapshot[], id: string): ProjectFile[] | null {
    const snapshot = VersionManager.get(history, id);
    return snapshot ? deepClone(snapshot.files) : null;
  }

  static forProject(history: VersionSnapshot[], projectId: string): VersionSnapshot[] {
    return history.filter((v) => v.projectId === projectId);
  }

  /** Aggregate +/- across a snapshot, for the history row badges. */
  static changeTotals(snapshot: VersionSnapshot): { additions: number; deletions: number } {
    return snapshot.changes.reduce(
      (acc, c) => ({ additions: acc.additions + c.additions, deletions: acc.deletions + c.deletions }),
      { additions: 0, deletions: 0 },
    );
  }

  /** Compares two snapshots — powers a future diff viewer. */
  static diff(a: VersionSnapshot, b: VersionSnapshot): FileChangeSummary[] {
    const changes: FileChangeSummary[] = [];
    const aMap = new Map(a.files.map((f) => [f.path, f]));
    const bMap = new Map(b.files.map((f) => [f.path, f]));

    for (const [path, bFile] of bMap) {
      const aFile = aMap.get(path);
      if (!aFile) {
        changes.push({ path, action: 'created', additions: bFile.content.split('\n').length, deletions: 0 });
      } else if (aFile.content !== bFile.content) {
        changes.push({ path, action: 'modified', additions: 0, deletions: 0 });
      }
    }
    for (const [path, aFile] of aMap) {
      if (!bMap.has(path)) {
        changes.push({ path, action: 'deleted', additions: 0, deletions: aFile.content.split('\n').length });
      }
    }
    return changes;
  }
}
