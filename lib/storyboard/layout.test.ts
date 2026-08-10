import { describe, expect, it } from 'vitest';
import {
  getStoryboardPanelCropStyle,
  getStoryboardPanelObjectPosition,
  STORYBOARD_PANEL_OVERSCAN_SCALE,
} from './layout';

describe('getStoryboardPanelObjectPosition', () => {
  it('pins each panel centre', () => {
    expect(getStoryboardPanelObjectPosition(0)).toBe('25% 25%');
    expect(getStoryboardPanelObjectPosition(1)).toBe('75% 25%');
    expect(getStoryboardPanelObjectPosition(2)).toBe('25% 75%');
    expect(getStoryboardPanelObjectPosition(3)).toBe('75% 75%');
  });

  it('clamps out-of-range panels the way the crop style does', () => {
    expect(getStoryboardPanelObjectPosition(-1)).toBe('25% 25%');
    expect(getStoryboardPanelObjectPosition(9)).toBe('75% 75%');
  });

  it('lands on the centre of the window the crop style exposes', () => {
    // The visible window is the wrapper region the container overlaps, as a
    // fraction of the wrapper. `object-position: P%` aligns the P% point of the
    // image with the P% point of the box, so P must equal that window's centre
    // for the crop to stay centred on the panel whatever the slot's aspect
    // ratio. This is what the hero backdrop was getting wrong: at the default
    // 50% the window sat over the bottom of the top-left panel.
    const size = STORYBOARD_PANEL_OVERSCAN_SCALE * 200;

    for (const panel of [0, 1, 2, 3]) {
      const crop = getStoryboardPanelCropStyle(panel);
      // The container is 100% wide/tall; `left`/`top` are negative offsets.
      const windowStartX = -parseFloat(crop.left);
      const windowStartY = -parseFloat(crop.top);
      const centreX = ((windowStartX + windowStartX + 100) / 2 / size) * 100;
      const centreY = ((windowStartY + windowStartY + 100) / 2 / size) * 100;

      expect(getStoryboardPanelObjectPosition(panel))
        .toBe(`${Math.round(centreX)}% ${Math.round(centreY)}%`);
    }
  });
});
