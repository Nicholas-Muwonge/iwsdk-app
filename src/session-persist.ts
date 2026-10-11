/**
 * XR session persistence for Spatial Terminal.
 *
 * Survives:
 * - Exit XR / re-enter (pause/resume)
 * - Accidental page reload during a review
 *
 * Cleared when the atomic loop completes (Approve / note + close).
 * Uses sessionStorage so data dies with the browser tab (safer for code).
 */

import type { PRPayload } from './dashboard.js';
import type { SpatialAnnotation } from './annotation.js';

const STORAGE_KEY = 'spatial-terminal:session:v1';

export interface PersistedSession {
  version: 1;
  savedAt: number;
  pr: PRPayload | null;
  activeFile: string | null;
  decisionMade: boolean;
  decision: 'approved' | 'changes_requested' | null;
  annotations: SpatialAnnotation[];
  /** Wall-clock when the immersive cockpit last started (for elapsed display) */
  sessionStartedAt: number | null;
}

function emptySession(): PersistedSession {
  return {
    version: 1,
    savedAt: Date.now(),
    pr: null,
    activeFile: null,
    decisionMade: false,
    decision: null,
    annotations: [],
    sessionStartedAt: null,
  };
}

function canUseStorage(): boolean {
  try {
    return typeof sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadPersistedSession(): PersistedSession | null {
  if (!canUseStorage()) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedSession;
    if (data?.version !== 1) return null;
    return data;
  } catch (err) {
    console.warn('[Persist] failed to load', err);
    return null;
  }
}

export function savePersistedSession(
  partial: Partial<PersistedSession>,
): void {
  if (!canUseStorage()) return;
  try {
    const current = loadPersistedSession() ?? emptySession();
    const next: PersistedSession = {
      ...current,
      ...partial,
      version: 1,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[Persist] failed to save', err);
  }
}

export function clearPersistedSession(): void {
  if (!canUseStorage()) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    console.log('[Persist] session cleared');
  } catch (err) {
    console.warn('[Persist] failed to clear', err);
  }
}

export function patchAnnotations(annotations: SpatialAnnotation[]): void {
  savePersistedSession({ annotations });
}