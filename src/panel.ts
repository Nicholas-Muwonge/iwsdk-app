/**
 * PanelSystem – welcome / launch panel interactions.
 *
 * - Enter Spatial Terminal → launchXR()
 * - Exit to Browser → exitXR()
 * - Load Demo PR #4920 → calls DashboardSystem.loadPR()
 * - Deep link (?pr=…) is resolved in index.ts; we only reflect status here
 */

import {
  createSystem,
  UIKitMLAsset,
  VisibilityState,
} from '@iwsdk/core';
import { DashboardSystem } from './dashboard.js';
import { parseDeepLink } from './deep-link.js';

export class PanelSystem extends createSystem({}) {
  private demoLoaded = false;
  private deepLinkPresent = false;
  private deepLinkPrId: number | null = null;

  init(): void {
    let panel: UIKitMLAsset | null = null;
    try {
      panel = this.world.requireSceneObject<UIKitMLAsset>('welcome-panel');
    } catch {
      console.warn('[Panel] welcome-panel not found in scene');
      return;
    }

    const xrButton = panel.getElementById('xr-button');
    const exitButton = panel.getElementById('exit-button');
    const demoButton = panel.getElementById('demo-btn');
    const statusText = panel.getElementById('status-text');

    if (xrButton == null || exitButton == null) {
      console.warn('[Panel] required buttons missing');
      return;
    }

    // Reflect deep link on the status chip (fetch happens in index.ts)
    const link = parseDeepLink();
    if (link.prId != null) {
      this.deepLinkPresent = true;
      this.deepLinkPrId = link.prId;
      if (statusText) {
        statusText.setProperties({
          text: `Deep link · PR #${link.prId} loading… · Enter XR`,
          class: 'status status-ready',
        });
      }
    }

    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      if (demoButton) demoButton.setProperties({ display: 'none' });
      if (statusText) {
        statusText.setProperties({ text: 'XR not available in this browser' });
      }
      return;
    }

    const launchXR = () => {
      if (statusText) {
        statusText.setProperties({
          text: 'Launching…',
          class: 'status status-ready',
        });
      }
      this.world.launchXR();
      // Emulator may not fire visibility immediately — force cockpit open
      window.setTimeout(() => {
        const dashboard = this.world.getSystem(DashboardSystem);
        dashboard?.ensureCockpit('after-launchXR');
      }, 500);
      window.setTimeout(() => {
        const dashboard = this.world.getSystem(DashboardSystem);
        dashboard?.ensureCockpit('after-launchXR-2s');
      }, 2000);
    };

    const exitXR = () => {
      this.world.exitXR();
      if (statusText) {
        statusText.setProperties({
          text: this.statusMessage(),
          class:
            this.deepLinkPresent || this.demoLoaded
              ? 'status status-ready'
              : 'status',
        });
      }
    };

    const loadDemo = () => {
      this.demoLoaded = true;

      const dashboard = this.world.getSystem(DashboardSystem);
      if (dashboard) {
        dashboard.loadPR({
          id: 4920,
          title: 'fix: merge conflict in auth',
          branch: 'main ← feature/auth-fix',
          files: [
            'src/auth/session.ts',
            'src/middleware/auth.ts',
            'tests/auth.test.ts',
          ],
          additions: 48,
          deletions: 12,
        });
      }

      if (statusText) {
        statusText.setProperties({
          text: 'Demo PR #4920 loaded · Enter XR to review',
          class: 'status status-ready',
        });
      }
      console.log('[Panel] Demo PR #4920 pushed to DashboardSystem');
    };

    xrButton.addEventListener('click', launchXR);
    exitButton.addEventListener('click', exitXR);
    if (demoButton) {
      demoButton.addEventListener('click', loadDemo);
    }

    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      () => {
        if (demoButton) demoButton.removeEventListener('click', loadDemo);
      },
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        if (demoButton) {
          demoButton.setProperties({ display: is2D ? 'flex' : 'none' });
        }
        if (statusText && is2D) {
          statusText.setProperties({
            text: this.statusMessage(),
            class:
              this.deepLinkPresent || this.demoLoaded
                ? 'status status-ready'
                : 'status',
          });
        }
      }),
    );
  }

  private statusMessage(): string {
    if (this.deepLinkPresent && this.deepLinkPrId != null) {
      return `Deep link · PR #${this.deepLinkPrId} · Enter XR`;
    }
    if (this.demoLoaded) {
      return 'Demo PR #4920 loaded · Enter XR to review';
    }
    return 'Ready · Gaze + Pinch';
  }
}
