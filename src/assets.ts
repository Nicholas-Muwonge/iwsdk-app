/**
 * Spatial Terminal – asset catalog
 * Only the UI panels needed for the pure cockpit experience.
 */

import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'welcome-panel': {
    url: publicAssetUrl('ui/welcome.uikitml'),
    type: AssetType.UIKitML,
    name: 'Welcome Panel',
  },
  'near-plane': {
    url: publicAssetUrl('ui/near-plane.uikitml'),
    type: AssetType.UIKitML,
    name: 'Near Plane (Status)',
  },
  'mid-plane': {
    url: publicAssetUrl('ui/mid-plane.uikitml'),
    type: AssetType.UIKitML,
    name: 'Mid Plane (Diff)',
  },
  'far-plane': {
    url: publicAssetUrl('ui/far-plane.uikitml'),
    type: AssetType.UIKitML,
    name: 'Far Plane (Overview)',
  },
});