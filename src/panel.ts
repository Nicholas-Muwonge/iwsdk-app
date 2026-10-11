/**
 * PanelSystem – welcome / launch panel interactions.
 *
 * - Enter Spatial Terminal → launchXR()
 * - Exit to Browser → exitXR()
 * - Load Demo PR #4920 → sets a simple flag + status (ready for deep-link later)
 */

import {
  createSystem,
  UIKitMLAsset,
  VisibilityState,
} from '@iwsdk/core';
import { DashboardSystem } from './dashboard.js';

export class PanelSystem extends createSystem({}) {
  private demoLoaded = false;

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
    };

    const exitXR = () => {
      this.world.exitXR();
      if (statusText) {
        statusText.setProperties({
          text: this.demoLoaded
            ? 'Demo PR loaded · Ready'
            : 'Ready · Gaze + Pinch',
          class: 'status',
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
            text: this.demoLoaded
              ? 'Demo PR #4920 loaded · Enter XR to review'
              : 'Ready · Gaze + Pinch',
          });
        }
      }),
    );
  }
}
