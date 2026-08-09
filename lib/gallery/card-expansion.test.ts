import { describe, expect, it } from 'vitest';
import {
  EXPAND_EDGE_GUTTER_PX,
  PORTRAIT_PANEL_WIDTH_LG_PX,
  PORTRAIT_PANEL_WIDTH_PX,
  resolveExpandedGeometry,
  resolveScrollAdjustment,
} from './card-expansion';

describe('resolveExpandedGeometry', () => {
  it('grows a wide card to 1.5x and stacks its panel below', () => {
    const geometry = resolveExpandedGeometry({
      restingWidth: 340,
      layout: 'wide',
      containerWidth: 1200,
    });

    expect(geometry).toEqual({ width: 510, placement: 'below', panelWidth: 0 });
  });

  it('puts a portrait panel beside the poster when the rail has room', () => {
    const geometry = resolveExpandedGeometry({
      restingWidth: 180,
      layout: 'portrait',
      containerWidth: 1200,
    });

    expect(geometry.placement).toBe('side');
    expect(geometry.panelWidth).toBe(PORTRAIT_PANEL_WIDTH_LG_PX);
    expect(geometry.width).toBe(180 * 1.5 + PORTRAIT_PANEL_WIDTH_LG_PX);
  });

  it('uses the narrower side panel below the large breakpoint', () => {
    const geometry = resolveExpandedGeometry({
      restingWidth: 150,
      layout: 'portrait',
      containerWidth: 900,
    });

    expect(geometry.placement).toBe('side');
    expect(geometry.panelWidth).toBe(PORTRAIT_PANEL_WIDTH_PX);
  });

  it('falls back to stacking a portrait panel when side by side will not fit', () => {
    // 390px phone: 150*1.5 + 240 + gutters is far wider than the viewport.
    const geometry = resolveExpandedGeometry({
      restingWidth: 150,
      layout: 'portrait',
      containerWidth: 390,
    });

    expect(geometry.placement).toBe('below');
    expect(geometry.panelWidth).toBe(0);
    expect(geometry.width).toBe(225);
  });

  it('never grows a card wider than the rail it lives in', () => {
    const geometry = resolveExpandedGeometry({
      restingWidth: 300,
      layout: 'wide',
      containerWidth: 390,
    });

    expect(geometry.width).toBe(390 - EXPAND_EDGE_GUTTER_PX * 2);
  });

  it('never shrinks a card below its resting width', () => {
    const geometry = resolveExpandedGeometry({
      restingWidth: 300,
      layout: 'wide',
      containerWidth: 200,
    });

    expect(geometry.width).toBe(300);
  });
});

describe('resolveScrollAdjustment', () => {
  const base = { scrollLeft: 0, clientWidth: 1000, gutter: 16 };

  it('leaves an already visible card alone', () => {
    expect(resolveScrollAdjustment({ ...base, itemLeft: 100, itemWidth: 400 })).toBe(0);
  });

  it('scrolls right by exactly the overflow', () => {
    // Right edge at 900; the visible right edge is 1000 - 16 = 984... fits.
    expect(resolveScrollAdjustment({ ...base, itemLeft: 700, itemWidth: 400 })).toBe(
      700 + 400 - (1000 - 16)
    );
  });

  it('scrolls left when the card starts before the visible area', () => {
    expect(
      resolveScrollAdjustment({ ...base, scrollLeft: 500, itemLeft: 400, itemWidth: 300 })
    ).toBe(400 - 16 - 500);
  });

  it('aligns a card too wide to fit to the leading edge', () => {
    expect(
      resolveScrollAdjustment({ ...base, scrollLeft: 200, itemLeft: 600, itemWidth: 990 })
    ).toBe(600 - 16 - 200);
  });
});
