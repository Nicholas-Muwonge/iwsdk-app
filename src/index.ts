/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PanelSystem } from './panel.js';
import { DashboardSystem } from './dashboard.js';
import { AnnotationSystem } from './annotation.js';
import { parseDeepLink, resolvePRFromId } from './deep-link.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then(async (world) => {
  world.registerSystem(PanelSystem);
  world.registerSystem(DashboardSystem);
  world.registerSystem(AnnotationSystem);

  const link = parseDeepLink();
  const dashboard = world.getSystem(DashboardSystem);

  if (link.prId != null && link.owner && link.repo) {
    try {
      const payload = await resolvePRFromId(link.prId, {
        owner: link.owner,
        repo: link.repo,
        token: link.token,
      });
      dashboard?.loadPR(payload);
      console.log(
        `[Spatial Terminal] Deep link → PR #${payload.id} (${payload.title})`,
      );
    } catch (err) {
      console.error('[Spatial Terminal] PR fetch failed', err);
      dashboard?.loadPR({
        id: link.prId,
        title: `PR #${link.prId} (offline / fetch failed)`,
        branch: 'unknown',
        files: [],
      });
    }
  } else {
    console.log('[Spatial Terminal] No deep link – use Load Demo or ?pr=4920');
  }

  console.log('[Spatial Terminal] World ready – seated, zero-locomotion mode');
});