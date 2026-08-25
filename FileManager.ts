/**
 * FileManager — the single authority for mutating a project's file tree.
 *
 * All writes funnel through here so that change summaries, timestamps and
 * language detection stay consistent. It is pure: every method returns a new
 * file array rather than mutating in place, which makes version snapshots and
 * undo trivially correct.
 *
 * Backend swap: replace the pure helpers with calls to a real filesystem /
 * object store while keeping these signatures.
 */

import type { FileChangeSummary, ProjectFile } from '../core/types';
import { diffStats, languageFromPath, now, uid } from '../core/utils';

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
  file?: ProjectFile;
}

export class FileManager {
  /** Creates a file record from a path + content. */
  static create(
    path: string,
    content: string,
    generatedBy: ProjectFile['generatedBy'] = 'agent',
  ): ProjectFile {
    const ts = now();
    return {
      id: uid('file'),
      path: FileManager.normalize(path),
      content,
      language: languageFromPath(path),
      generatedBy,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  static normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  }

  static find(files: ProjectFile[], path: string): ProjectFile | undefined {
    const p = FileManager.normalize(path);
    return files.find((f) => f.path === p);
  }

  /**
   * Applies a batch of writes and deletions, returning the next file array
   * plus a per-file change summary for the UI and version history.
   */
  static applyChanges(
    files: ProjectFile[],
    writes: Array<{ path: string; content: string }>,
    deletions: string[] = [],
    author: ProjectFile['generatedBy'] = 'agent',
  ): { files: ProjectFile[]; changes: FileChangeSummary[] } {
    let next = [...files];
    const changes: FileChangeSummary[] = [];

    for (const write of writes) {
      const path = FileManager.normalize(write.path);
      const index = next.findIndex((f) => f.path === path);
      if (index === -1) {
        next.push(FileManager.create(path, write.content, author));
        changes.push({
          path,
          action: 'created',
          additions: write.content.split('\n').length,
          deletions: 0,
        });
      } else {
        const before = next[index].content;
        if (before === write.content) continue; // no-op write
        const stats = diffStats(before, write.content);
        next[index] = {
          ...next[index],
          content: write.content,
          language: languageFromPath(path),
          updatedAt: now(),
        };
        changes.push({ path, action: 'modified', ...stats });
      }
    }

    for (const raw of deletions) {
      const path = FileManager.normalize(raw);
      const target = next.find((f) => f.path === path);
      if (!target) continue;
      next = next.filter((f) => f.path !== path);
      changes.push({
        path,
        action: 'deleted',
        additions: 0,
        deletions: target.content.split('\n').length,
      });
    }

    return { files: FileManager.sort(next), changes };
  }

  static rename(files: ProjectFile[], fromPath: string, toPath: string): ProjectFile[] {
    const from = FileManager.normalize(fromPath);
    const to = FileManager.normalize(toPath);
    return FileManager.sort(
      files.map((f) =>
        f.path === from ? { ...f, path: to, language: languageFromPath(to), updatedAt: now() } : f,
      ),
    );
  }

  /** Folders first, then alphabetical — matches editor conventions. */
  static sort(files: ProjectFile[]): ProjectFile[] {
    return [...files].sort((a, b) => {
      const aDepth = a.path.split('/').length;
      const bDepth = b.path.split('/').length;
      if (aDepth !== bDepth) return aDepth - bDepth;
      return a.path.localeCompare(b.path);
    });
  }

  /** Builds the nested tree consumed by the sidebar explorer. */
  static buildTree(files: ProjectFile[]): TreeNode[] {
    const root: TreeNode[] = [];

    const insert = (node: TreeNode[], segments: string[], file: ProjectFile, prefix: string) => {
      const [head, ...rest] = segments;
      const path = prefix ? `${prefix}/${head}` : head;

      if (rest.length === 0) {
        node.push({ name: head, path, type: 'file', file });
        return;
      }

      let folder = node.find((n) => n.type === 'folder' && n.name === head);
      if (!folder) {
        folder = { name: head, path, type: 'folder', children: [] };
        node.push(folder);
      }
      insert(folder.children!, rest, file, path);
    };

    for (const file of files) insert(root, file.path.split('/'), file, '');

    const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of nodes) if (n.children) sortNodes(n.children);
      return nodes;
    };

    return sortNodes(root);
  }

  static totalLines(files: ProjectFile[]): number {
    return files.reduce((sum, f) => sum + f.content.split('\n').length, 0);
  }

  /** Rough byte size for the stats strip. */
  static totalBytes(files: ProjectFile[]): number {
    return files.reduce((sum, f) => sum + new Blob([f.content]).size, 0);
  }
}
