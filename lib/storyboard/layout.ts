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

function resolvePanelCell(panelIndex: number): { col: 0 | 1; row: 0 | 1 } {
  const clampedPanel = Math.max(0, Math.min(STORYBOARD_PANEL_COUNT - 1, Math.floor(panelIndex)));
  return {
    col: (clampedPanel % 2) as 0 | 1,
    row: clampedPanel >= 2 ? 1 : 0,
  };
}

/**
 * `object-position` for the image inside the crop wrapper.
 *
 * The wrapper inherits its aspect ratio from the slot it fills, which is not
 * the source image's — a full-bleed hero backdrop is far wider than a 16:9
 * cover. `object-cover` therefore trims the image *before* the panel window is
 * applied, and at the default `50% 50%` the window lands off-centre on the
 * panel: the gallery hero was showing the bottom ~60% of the top-left panel,
 * cutting off whatever the panel framed at its top.
 *
 * Percentage positions align the same fractional point of the image and of the
 * box, so pinning the panel's own centre (25% or 75% along each axis) keeps the
 * window centred on that panel whatever the slot's aspect ratio. When the two
 * aspect ratios do match the image fits exactly and this has no effect.
 */
export function getStoryboardPanelObjectPosition(panelIndex: number): string {
  const { col, row } = resolvePanelCell(panelIndex);
  return `${col === 0 ? 25 : 75}% ${row === 0 ? 25 : 75}%`;
}

export function getStoryboardPanelCropStyle(panelIndex: number): StoryboardPanelCropStyle {
  const { col, row } = resolvePanelCell(panelIndex);
  const sizePercent = STORYBOARD_PANEL_OVERSCAN_SCALE * 200;
  const centeredCropOffsetPercent = (STORYBOARD_PANEL_OVERSCAN_SCALE - 1) * 50;

  return {
    width: `${sizePercent}%`,
    height: `${sizePercent}%`,
    left: `-${col * 100 * STORYBOARD_PANEL_OVERSCAN_SCALE + centeredCropOffsetPercent}%`,
    top: `-${row * 100 * STORYBOARD_PANEL_OVERSCAN_SCALE + centeredCropOffsetPercent}%`,
  };
}
