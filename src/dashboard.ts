/**
 * DashboardSystem – creates the 1.5-foot radius curved cockpit
 * with three depth-stacked planes (near / mid / far).
 *
 * Airplane Seat Test constraints:
 * - Everything stays inside ~0.45 m radius of the chest / head
 * - No large arm reach required
 * - Gaze + pinch only (RayInteractable)
 * - Depth layers instead of wide horizontal layout
 */

import {
  createSystem,
  FollowBehavior,
  Follower,
  RayInteractable,
  UIKitMLAsset,
  VisibilityState,
} from '@iwsdk/core';

import {AnnotationSystem} from './annotation.js';
import {
  loadPersistedSession,
  savePersistedSession,
  clearPersistedSession,
} from './session-persist.js';
import {
  postPRComment,
  formatAnnotationComment,
} from './github.js';
import { parseDeepLink } from './deep-link.js';

/** Physical distances (meters) for the three depth planes */
/** Layout: DECIDE high+near, REVIEW center, NAVIGATE right+far */
const DEPTH = { near: 0.48, mid: 0.78, far: 1.05 } as const;
const ARC = {
  near: { x: 0, y: 0.16 },
  mid: { x: -0.02, y: -0.06 },
  far: { x: 0.32, y: 0.04 },
} as const;
const SCALE = { near: 0.28, mid: 0.38, far: 0.30 } as const;

const MAX_SESSION_MS = 10 * 60 * 1000;  // 10 min hard cap
const IDLE_TIMEOUT_MS = 2 * 60 * 1000;  // 2 min idle
const WARN_BEFORE_MAX_MS = 30 * 1000;   // warn 30s before max
const TIMEOUT_TICK_MS = 1000;

interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  num: string;
  text: string;
}

interface FileDiff {
  path: string;
  hunkLabel: string;
  hunkHeader: string;
  summary: string;
  lines: DiffLine[];
}

const FILE_DIFFS: Record<string, FileDiff> = {
  'src/auth/session.ts': {
    path: 'src/auth/session.ts',
    hunkLabel: 'Hunk 1 of 2',
    hunkHeader: '@@ -42,7 +42,12 @@ export function validateSession',
    summary: 'jwt.decode -> jwt.verify + expiry check',
    lines: [
      { kind: 'ctx', num: '42', text: '  if (!token) return null;' },
      { kind: 'del', num: '43', text: '-  const payload = jwt.decode(token);' },
      { kind: 'add', num: '43', text: '+  const payload = await jwt.verify(token, secret);' },
      { kind: 'add', num: '44', text: '+  if (!payload || payload.exp < Date.now() / 1000) {' },
      { kind: 'add', num: '45', text: '+    return null;' },
      { kind: 'add', num: '46', text: '+  }' },
      { kind: 'ctx', num: '47', text: '  return payload as SessionPayload;' },
    ],
  },
  'src/middleware/auth.ts': {
    path: 'src/middleware/auth.ts',
    hunkLabel: 'Hunk 1 of 1',
    hunkHeader: '@@ -18,5 +18,8 @@ export async function requireAuth',
    summary: 'requireAuth now awaits validateSession',
    lines: [
      { kind: 'ctx', num: '18', text: '  const header = req.headers.authorization;' },
      { kind: 'del', num: '19', text: '-  const session = validateSession(header);' },
      { kind: 'add', num: '19', text: '+  const session = await validateSession(header);' },
      { kind: 'ctx', num: '20', text: '  if (!session) {' },
      { kind: 'ctx', num: '21', text: '    return res.status(401).end();' },
      { kind: 'add', num: '22', text: '+  req.session = session;' },
      { kind: 'ctx', num: '23', text: '  return next();' },
    ],
  },
  'tests/auth.test.ts': {
    path: 'tests/auth.test.ts',
    hunkLabel: 'Hunk 1 of 1',
    hunkHeader: '@@ -55,3 +55,14 @@ describe("validateSession"',
    summary: 'added expired-token + missing-secret cases',
    lines: [
      { kind: 'ctx', num: '55', text: '  it("rejects missing token", async () => {' },
      { kind: 'ctx', num: '56', text: '    expect(await validateSession(null)).toBeNull();' },
      { kind: 'ctx', num: '57', text: '  });' },
      { kind: 'add', num: '58', text: '+  it("rejects expired token", async () => {' },
      { kind: 'add', num: '59', text: '+    const t = sign({ exp: 1 });' },
      { kind: 'add', num: '60', text: '+    expect(await validateSession(t)).toBeNull();' },
      { kind: 'add', num: '61', text: '+  });' },
    ],
  },
};

const FILE_IDS: Record<string, string> = {
  'file-session': 'src/auth/session.ts',
  'file-middleware': 'src/middleware/auth.ts',
  'file-test': 'tests/auth.test.ts',
};

export interface PRPayload {
  id: number;
  title: string;
  branch: string;
  files: string[];
  additions?: number;
  deletions?: number;
}

export class DashboardSystem extends createSystem({}) {
  private nearAsset: UIKitMLAsset | null = null;
  private midAsset: UIKitMLAsset | null = null;
  private farAsset: UIKitMLAsset | null = null;
  private nearEntity: ReturnType<typeof this.world.createTransformEntity> | null =
    null;
  private midEntity: ReturnType<typeof this.world.createTransformEntity> | null =
    null;
  private farEntity: ReturnType<typeof this.world.createTransformEntity> | null =
    null;
  private created = false;
  private decisionMade = false;
  private sessionStartedAt = 0;
  private sessionClosing = false;
  private activeFile = 'src/auth/session.ts';
  private pendingPR: PRPayload | null = null;
  private lastInteractionAt = 0;
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;
  private touchInteraction(): void {
    this.lastInteractionAt = Date.now();
  }
  private maxWarned = false;
  private reviewedFiles = new Set<string>();

  private clearSessionTimers(): void {
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private startSessionTimers(): void {
    this.clearSessionTimers();
    this.updateTimerChip();
    this.lastInteractionAt = Date.now();

    this.timeoutTimer = window.setInterval(() => {
      const now = Date.now();
      const idleMs = now - this.lastInteractionAt;
      const sessionMs = now - this.sessionStartedAt;

      if (sessionMs >= MAX_SESSION_MS) {
        this.onXrSessionEnded('max_session');
        return;
      }

      if (idleMs >= IDLE_TIMEOUT_MS) {
        this.onXrSessionEnded('idle_timeout');
        return;
      }

      if (
        sessionMs >= MAX_SESSION_MS - WARN_BEFORE_MAX_MS &&
        !this.maxWarned
      ) {
        this.maxWarned = true;
        console.warn('[Dashboard] Session is nearing the hard cap');
      }
    }, TIMEOUT_TICK_MS);
  }

  private onXrSessionEnded(reason: string): void {
    this.clearSessionTimers();

    if (this.sessionClosing) return;
    this.sessionClosing = true;

    console.log(`[Dashboard] XR session ended (${reason})`);

    try {
      this.world.exitXR();
    } catch (err) {
      console.warn('[Dashboard] exitXR failed during session end', err);
    }

    window.setTimeout(() => {
      this.sessionClosing = false;
    }, 250);
  }

  init(): void {
    // XR active ≈ Visible / VisibleBlurred (no ImmersiveVR on VisibilityState)
    console.log('[Dashboard] init() running');
    const isImmersive = (state: VisibilityState) =>
      state === VisibilityState.Visible ||
      state === VisibilityState.VisibleBlurred;

    const tryCreate = (reason: string) => {
      if (this.created) return;
      console.log(`[Dashboard] tryCreate (${reason})`);
      this.createDashboard().catch((err) =>
        console.error('[Dashboard] failed to create', err),
      );
    };

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        console.log('[Dashboard] visibility →', state);
        if (isImmersive(state)) {
          tryCreate('visibility-subscribe');
        }
        if (state === VisibilityState.NonImmersive) {
          this.onXrSessionEnded('visibility');
        }
      }),
    );
    this.cleanupFuncs.push(() => this.clearSessionTimers());

    const current = this.world.visibilityState.value;
    console.log('[Dashboard] init visibility =', current);
    if (isImmersive(current)) {
      tryCreate('init-already-immersive');
    }

    let retries = 0;
    const retryId = window.setInterval(() => {
      if (this.created || retries >= 20) {
        window.clearInterval(retryId);
        return;
      }
      retries += 1;
      const state = this.world.visibilityState.value;
      if (isImmersive(state) && this.world.player?.head) {
        tryCreate(`retry-${retries}`);
      }
    }, 250);
    this.cleanupFuncs.push(() => window.clearInterval(retryId));
  }

  private async createDashboard(): Promise<void> {
    if (this.created) return;
    this.created = true;

    const head = this.world.player?.head;
    if (!head) {
      console.warn('[Dashboard] player.head not ready yet');
      this.created = false;
      return;
    }

    try{

      // --- Near plane (status) ---
      this.nearAsset = await this.world.assets.instantiate<UIKitMLAsset>(
        'near-plane',
      );
      this.nearEntity = this.world.createTransformEntity(this.nearAsset, {
        persistent: true,
      });
      this.nearEntity.object3D!.scale.setScalar(SCALE.near);
      this.nearEntity.addComponent(RayInteractable);
      this.nearEntity.addComponent(Follower, {
        target: head,
        offsetPosition: [ARC.near.x, ARC.near.y, -DEPTH.near],
        behavior: FollowBehavior.PivotY,
        speed: 2.5,
        tolerance: 0.15,
        maxAngle: 25,
      });
      // Pin in front of seated camera (looks toward -Z)
      this.nearEntity.object3D!.position.set(0, 1.62, -0.55);
      this.nearEntity.object3D!.visible = true;
      this.wireNearPlaneActions(this.nearAsset);

      // --- Mid plane (diff) ---
      this.midAsset = await this.world.assets.instantiate<UIKitMLAsset>(
        'mid-plane',
      );
      this.midEntity = this.world.createTransformEntity(this.midAsset, {
        persistent: true,
      });
      this.midEntity.object3D!.scale.setScalar(SCALE.mid);
      this.midEntity.addComponent(RayInteractable);
      this.midEntity.addComponent(Follower, {
        target: head,
        offsetPosition: [ARC.mid.x, ARC.mid.y, -DEPTH.mid],
        behavior: FollowBehavior.PivotY,
        speed: 2.2,
        tolerance: 0.18,
        maxAngle: 28,
      });
      this.midEntity.object3D!.position.set(0, 1.32, -0.9);
      this.midEntity.object3D!.visible = true;

      // --- Far plane (overview) ---
      this.farAsset = await this.world.assets.instantiate<UIKitMLAsset>(
        'far-plane',
      );
      this.farEntity = this.world.createTransformEntity(this.farAsset, {
        persistent: true,
      });
      this.farEntity.object3D!.scale.setScalar(SCALE.far);
      this.farEntity.addComponent(RayInteractable);
      this.farEntity.addComponent(Follower, {
        target: head,
        offsetPosition: [ARC.far.x, ARC.far.y, -DEPTH.far],
        behavior: FollowBehavior.PivotY,
        speed: 2.0,
        tolerance: 0.2,
        maxAngle: 30,
      });
      this.farEntity.object3D!.position.set(0.42, 1.4, -1.15);
      this.farEntity.object3D!.visible = true;

      // Inline far-plane file wiring
      for (const [id, path] of Object.entries(FILE_IDS)) {
        const el = this.farAsset.getElementById(id);
        if (!el) continue;
        const onSelect = () => this.selectFile(path);
        el.addEventListener('click', onSelect);
        this.cleanupFuncs.push(() =>
          el.removeEventListener('click', onSelect),
        );
      }
      console.log('[Dashboard] Far-plane file switching wired');

      if (this.pendingPR) this.applyPR(this.pendingPR);
      this.selectFile(this.activeFile);

      this.sessionStartedAt = Date.now();
      this.lastInteractionAt = Date.now();
      this.maxWarned = false;
      //this.startSessionTimers();
      console.log('[Dashboard] cockpit created with hree depth planes');

    } catch (err) {
      this.created = false;
      this.nearAsset = null;
      this.midAsset = null;
      this.farAsset = null;
      console.error('[Dashboard] cockpit creation failed – will retry on next visibility change');
      throw err;
      }
  }


  public loadPR(payload: PRPayload): void {
    this.pendingPR = payload;
    this.decisionMade = false;
    this.reviewedFiles.clear();
    if (payload.files.length > 0) this.activeFile = payload.files[0];

    savePersistedSession({
      pr: payload,
      activeFile: this.activeFile,
      decisionMade: false,
      decision: null,
    });

    if (this.created && this.nearAsset) {
      this.applyPR(payload);
      this.selectFile(this.activeFile);
    } else {
      console.log(
        `[Dashboard] PR #${payload.id} queued – will apply when cockpit opens`,
      );
    }
  }

  private applyPR(payload: PRPayload): void {
    if (!this.nearAsset) return;

    const titleEl = this.nearAsset.getElementById('pr-title');
    if (titleEl) {
      titleEl.setProperties({
        text: `PR #${payload.id} · ${payload.title}`,
      });
    }

    // Reset buttons + hide previous result
    const actionsRow = this.nearAsset.getElementById('actions-row');
    const resultBanner = this.nearAsset.getElementById('result-banner');
    if (actionsRow) actionsRow.setProperties({ display: 'flex' });
    if (resultBanner) resultBanner.setProperties({ display: 'none' });

    // Drive NAVIGATE slots from payload.files (first 3)
    if (payload.files.length > 0) {
      this.slotPaths = payload.files.slice(0, 3);
      while (this.slotPaths.length < 3) {
        this.slotPaths.push(this.slotPaths[this.slotPaths.length - 1] ?? '—');
      }
    }
    this.syncFarPlaneLabels();
    this.setMilestone('open');

    // Far plane stats
    if (this.farAsset && payload.files.length > 0) {
      const statsEl = this.farAsset.getElementById('overview-stats');
      if (statsEl) {
        statsEl.setProperties({
          text: `${payload.files.length} files · ready for review`,
        });
      }
    }

    console.log(`[Dashboard] Loaded PR #${payload.id} – ${payload.title}`);
  }

  private wireNearPlaneActions(panel: UIKitMLAsset): void {
    const approveBtn = panel.getElementById('approve-btn');
    const requestBtn = panel.getElementById('request-changes-btn');
    const resultBanner = panel.getElementById('result-banner');
    const actionsRow = panel.getElementById('actions-row');
    const chipRow = panel.getElementById('chip-row');

    if (!approveBtn || !requestBtn) {
      console.warn('[Dashboard] Approve / Request Changes buttons not found');
      return;
    }

    const onApprove = () => {
      if (this.decisionMade) return;
      this.decisionMade = true;
      const id = this.pendingPR?.id ?? 4920;
      console.log('[Dashboard] PR #4920 APPROVED');

      if (actionsRow) actionsRow.setProperties({ display: 'none' });
      this.completeSession({
        panel,
        resultBanner,
        decision: 'approved',
        prId: id,
      });

      if (resultBanner) {
        resultBanner.setProperties({
          display: 'flex',
          text: '✓ Approved · Session complete',
          class: 'result-banner result-approved',
        });
      }
    };

    const onRequestChanges = () => {
      if (this.decisionMade) return;
      this.decisionMade = true;
      const id = this.pendingPR?.id ?? 4920;
      const filePath = this.activeFile;
      console.log(`[Dashboard] PR #${id} REQUEST CHANGES on ${filePath}`);

      if (actionsRow) actionsRow.setProperties({ display: 'none' });
      if (resultBanner) {
        resultBanner.setProperties({
          display: 'flex',
          text: '✎ Changes requested · speak your note',
          class: 'result-banner result-changes',
        });
      }

      const annotationLine = panel.getElementById('annotation-line');
      const setAnnStatus = (
        text: string,
        mode: 'listening' | 'saved' | 'idle',
      ) => {
        if (!annotationLine) return;
        const cls =
          mode === 'listening'
            ? 'annotation-line annotation-listening'
            : mode === 'saved'
              ? 'annotation-line annotation-saved'
              : 'annotation-line';
        annotationLine.setProperties({ display: 'flex', text, class: cls });
      };

      const annotationSys = this.world.getSystem(AnnotationSystem);
      if (!annotationSys) {
        setAnnStatus('Annotation system not registered', 'idle');
        return;
      }

      annotationSys.startListening({
        prId: id,
        filePath,
        onStatus: (msg) => setAnnStatus(msg, 'listening'),
        onComplete: (ann) => {
          setAnnStatus(
            `Note on ${ann.filePath.split('/').pop()}: "${ann.transcript.slice(0, 60)}${
              ann.transcript.length > 60 ? '…' : ''
            }"`,
            'saved',
          );
          this.completeSession({
            panel,
            resultBanner,
            decision: 'changes_requested',
            prId: id,
            annotationPreview: ann.transcript,
          });
          
          if (resultBanner) {
            resultBanner.setProperties({
              text: '✎ Changes requested · note saved',
              class: 'result-banner result-changes',
            });
          }
        },
      });
    };

    approveBtn.addEventListener('click', onApprove);
    requestBtn.addEventListener('click', onRequestChanges);

    this.cleanupFuncs.push(
      () => approveBtn.removeEventListener('click', onApprove),
      () => requestBtn.removeEventListener('click', onRequestChanges),
    );
  }

  private completeSession(opts: {
    panel: UIKitMLAsset;
    resultBanner: ReturnType<UIKitMLAsset['getElementById']>;
    decision: 'approved' | 'changes_requested';
    prId: number;
    annotationPreview?: string;
  }): void {
    if (this.sessionClosing) return;
    this.sessionClosing = true;

    const elapsedMs = this.sessionStartedAt
      ? Date.now() - this.sessionStartedAt
      : 0;
    const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const timeLabel =
      mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;

    const fileCount =
      this.pendingPR?.files?.length ?? Object.keys(FILE_IDS).length;

    let summary =
      opts.decision === 'approved'
        ? `✓ Approved · PR #${opts.prId} · ${fileCount} files · ${timeLabel}`
        : `✎ Changes requested · note saved · ${timeLabel}`;

    if (opts.resultBanner) {
      opts.resultBanner.setProperties({
        display: 'flex',
        text: summary,
        class:
          opts.decision === 'approved'
            ? 'result-banner result-approved'
            : 'result-banner result-changes',
      });
    }

    console.log(`[Dashboard] Session complete -> ${summary}`);

    // Entertainment feedback
    if (opts.decision === 'approved') {
      this.playTone(523, 90);
      window.setTimeout(() => this.playTone(659, 90), 100);
      window.setTimeout(() => this.playTone(784, 140), 200);
    } else {
      this.playTone(392, 100, 'triangle');
      window.setTimeout(() => this.playTone(330, 140, 'triangle'), 120);
    }

    window.setTimeout(() => {
      try {
        this.world.exitXR();
        console.log('[Dashboard] XR session closed (atomic loop done)');
      } catch (err) {
        console.warn('[Dashboard] exitXR failed', err);
      }
      this.sessionClosing = false;
    }, 2800);
  }

  public selectFile(filePath: string): void {
    this.touchInteraction();
    this.activeFile = filePath;
    this.reviewedFiles.add(filePath);
    this.setMilestone('review');
    savePersistedSession({ activeFile: filePath });
    const diff = FILE_DIFFS[filePath];

    // --- REVIEW zone (mid) ---
    if (this.midAsset) {
      const fileNameEl = this.midAsset.getElementById('current-file');
      const hunkInfoEl = this.midAsset.getElementById('hunk-info');
      const summaryEl = this.midAsset.getElementById('diff-summary');
      const hunkHeaderEl = this.midAsset.getElementById('hunk-header');
      if (fileNameEl) fileNameEl.setProperties({ text: filePath });
      if (hunkInfoEl) {
        hunkInfoEl.setProperties({
          text: diff ? diff.hunkLabel : 'No hunks',
        });
      }
      if (summaryEl) {
        summaryEl.setProperties({
          text: diff ? diff.summary : 'No diff loaded',
        });
      }
      if (hunkHeaderEl && diff) {
        hunkHeaderEl.setProperties({ text: diff.hunkHeader });
      }
      for (let i = 0; i < 7; i++) {
        const row = this.midAsset.getElementById(`line-${i}`);
        const num = this.midAsset.getElementById(`line-${i}-num`);
        const text = this.midAsset.getElementById(`line-${i}-text`);
        const line = diff?.lines[i];
        if (!row) continue;
        if (!line) {
          row.setProperties({ display: 'none' });
          continue;
        }
        const cls =
          line.kind === 'add'
            ? 'line line-add'
            : line.kind === 'del'
              ? 'line line-del'
              : 'line line-ctx';
        row.setProperties({ display: 'flex', class: cls });
        if (num) num.setProperties({ text: line.num });
        if (text) text.setProperties({ text: line.text });
      }
    }

    // --- NAVIGATE zone (far) ---
    if (this.farAsset) {
      for (const [id, path] of Object.entries(FILE_IDS)) {
        const el = this.farAsset.getElementById(id);
        if (!el) continue;
        el.setProperties({
          class: path === filePath ? 'file-item file-item-active' : 'file-item',
        });
      }
      const statsEl = this.farAsset.getElementById('overview-stats');
      if (statsEl) {
        const total = Object.keys(FILE_IDS).length;
        statsEl.setProperties({
          text: `${this.reviewedFiles.size}/${total} files reviewed`,
        });
      }
    }

    // --- DECIDE zone progress ---
    if (this.nearAsset) {
      const progress = this.nearAsset.getElementById('progress-chip');
      if (progress) {
        const total = Object.keys(FILE_IDS).length;
        progress.setProperties({
          text: `${this.reviewedFiles.size}/${total} reviewed`,
        });
      }
    }
    this.playTone(660, 40, 'square');
    console.log(`[Dashboard] REVIEW focus -> ${filePath}`);
  }

  public ensureCockpit(reason = 'ensureCockpit'): void {
    if (this.created) {
      console.log('[Dashboard] ensureCockpit: already created');
      return;
    }
    console.log(`[Dashboard] ensureCockpit (${reason})`);
    this.createDashboard().catch((err) =>
      console.error('[Dashboard] ensureCockpit failed', err),
    );
  }

  /** Light entertainment: short Web Audio cue (no assets required) */
  private playTone(
    freq: number,
    durationMs = 120,
    type: OscillatorType = 'sine',
  ): void {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + durationMs / 1000,
      );
      osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
      window.setTimeout(() => void ctx.close(), durationMs + 50);
    } catch {
      /* audio optional */
    }
  }


  private slotPaths: string[] = [
    'src/auth/session.ts',
    'src/middleware/auth.ts',
    'tests/auth.test.ts',
  ];
  private milestoneStep: 'open' | 'review' | 'decide' = 'open';

  private syncFarPlaneLabels(): void {
    if (!this.farAsset) return;
    const ids = ['file-session', 'file-middleware', 'file-test'] as const;
    const labelIds = [
      'file-session-label',
      'file-middleware-label',
      'file-test-label',
    ] as const;
    ids.forEach((id, i) => {
      const path = this.slotPaths[i];
      const label = this.farAsset!.getElementById(labelIds[i]);
      if (label && path) {
        const short = path.split('/').slice(-2).join('/');
        label.setProperties({ text: short });
      }
      if (path) {
        (FILE_IDS as Record<string, string>)[id] = path;
      }
    });
  }

  private setMilestone(step: 'open' | 'review' | 'decide'): void {
    this.milestoneStep = step;
    if (!this.nearAsset) return;
    const el = this.nearAsset.getElementById('milestone-line');
    if (!el) return;
    const labels = {
      open: '1 Open ✓ · 2 Review · 3 Decide',
      review: '1 Open ✓ · 2 Review ✓ · 3 Decide',
      decide: '1 Open ✓ · 2 Review ✓ · 3 Decide →',
    };
    el.setProperties({ text: labels[step], display: 'flex' });
  }

  private updateTimerChip(): void {
    if (!this.nearAsset || !this.sessionStartedAt) return;
    const el = this.nearAsset.getElementById('timer-chip');
    if (!el) return;
    const sec = Math.max(
      0,
      Math.floor((Date.now() - this.sessionStartedAt) / 1000),
    );
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    el.setProperties({
      text: `${m}:${String(s).padStart(2, '0')}`,
      display: 'flex',
    });
  }

  
}