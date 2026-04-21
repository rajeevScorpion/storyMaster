export const STORYBOARD_PANEL_COUNT = 4;
export const STORYBOARD_PANEL_SEQUENCE = [0, 1, 2, 3] as const;
export const STORYBOARD_PANEL_OVERSCAN_SCALE = 1.06;
export const STORYBOARD_PANEL_CROP_INSET_RATIO = 0.025;
export const STORYBOARD_PANEL_DIVIDER_COLOR = '#050505';
export const STORYBOARD_PANEL_DIVIDER_RATIO = 0.003;

export interface StoryboardPanelCropStyle {
  left: string;
  top: string;
  width: string;
  height: string;
}

export function getStoryboardPanelCropStyle(panelIndex: number): StoryboardPanelCropStyle {
  const clampedPanel = Math.max(0, Math.min(STORYBOARD_PANEL_COUNT - 1, Math.floor(panelIndex)));
  const col = clampedPanel % 2;
  const row = clampedPanel >= 2 ? 1 : 0;
  const sizePercent = STORYBOARD_PANEL_OVERSCAN_SCALE * 200;
  const centeredCropOffsetPercent = (STORYBOARD_PANEL_OVERSCAN_SCALE - 1) * 50;

  return {
    width: `${sizePercent}%`,
    height: `${sizePercent}%`,
    left: `-${col * 100 * STORYBOARD_PANEL_OVERSCAN_SCALE + centeredCropOffsetPercent}%`,
    top: `-${row * 100 * STORYBOARD_PANEL_OVERSCAN_SCALE + centeredCropOffsetPercent}%`,
  };
}
