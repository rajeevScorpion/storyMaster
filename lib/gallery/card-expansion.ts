import type { GalleryRailLayout } from '@/lib/types/database';

/**
 * Geometry for the gallery's expand-in-place cards.
 *
 * The rail scroller is `overflow-x-auto`, which makes its block axis `auto`
 * too, so an expanded card cannot spill out of it — it has to grow in flow.
 * That is what makes siblings slide right and the rail grow taller for free,
 * and it is why every number here is a width the rail writes onto the card's
 * flex item rather than a transform.
 *
 * Kept free of React and of breakpoint class names: the rail measures the
 * resting slot at runtime and feeds the numbers in, so the same rules hold at
 * every breakpoint and can be tested without a DOM.
 */

/** How much bigger the artwork gets when a card expands. */
export const EXPAND_SCALE = 1.5;

/** Info-panel width when a portrait card opens its panel to the side. */
export const PORTRAIT_PANEL_WIDTH_PX = 240;
export const PORTRAIT_PANEL_WIDTH_LG_PX = 280;

/** Viewport at which the wider side panel is worth the horizontal room. */
const PANEL_WIDTH_BREAKPOINT_PX = 1024;

/**
 * Breathing room kept between an expanded card and the scroller edge, so the
 * card never sits flush against the gutter or under an edge fade.
 */
export const EXPAND_EDGE_GUTTER_PX = 16;

/**
 * Where a card's info block goes once expanded. Wide cards always stack it
 * under the artwork; portrait cards put it alongside when there is room, and
 * fall back to stacking on narrow viewports.
 */
export type ExpandedPanelPlacement = 'below' | 'side';

export interface ExpandedGeometry {
  /** Total width of the expanded flex item, in px. */
  width: number;
  placement: ExpandedPanelPlacement;
  /** Width of the side panel; 0 when the panel is stacked below. */
  panelWidth: number;
}

export function portraitPanelWidth(containerWidth: number): number {
  return containerWidth >= PANEL_WIDTH_BREAKPOINT_PX
    ? PORTRAIT_PANEL_WIDTH_LG_PX
    : PORTRAIT_PANEL_WIDTH_PX;
}

/**
 * Resolve the expanded width and panel placement for one card.
 *
 * A portrait card at 1.5× plus a side panel is ~550px, which does not fit a
 * phone. Rather than let it overflow the page, it degrades to the wide card's
 * treatment: artwork at 1.5× (capped to the scroller) with the panel stacked
 * underneath.
 */
export function resolveExpandedGeometry({
  restingWidth,
  layout,
  containerWidth,
  gutter = EXPAND_EDGE_GUTTER_PX,
}: {
  restingWidth: number;
  layout: GalleryRailLayout;
  containerWidth: number;
  gutter?: number;
}): ExpandedGeometry {
  const maxWidth = Math.max(restingWidth, containerWidth - gutter * 2);
  const artworkWidth = Math.min(restingWidth * EXPAND_SCALE, maxWidth);

  if (layout === 'wide') {
    return { width: artworkWidth, placement: 'below', panelWidth: 0 };
  }

  const panelWidth = portraitPanelWidth(containerWidth);
  const sideBySideWidth = restingWidth * EXPAND_SCALE + panelWidth;

  if (sideBySideWidth + gutter * 2 <= containerWidth) {
    return { width: sideBySideWidth, placement: 'side', panelWidth };
  }

  return { width: artworkWidth, placement: 'below', panelWidth: 0 };
}

/**
 * How far to scroll the rail so a freshly expanded card is fully visible.
 *
 * Returns a delta to add to `scrollLeft`; 0 when the card already fits. Doing
 * the arithmetic here rather than calling `scrollIntoView` matters: that would
 * also scroll the page vertically, and the gallery has a fixed top scrim it
 * would slide content under.
 *
 * A card too wide to fit at all is aligned to the left edge, so the reader sees
 * its artwork and CTA rather than its trailing edge.
 */
export function resolveScrollAdjustment({
  itemLeft,
  itemWidth,
  scrollLeft,
  clientWidth,
  gutter = EXPAND_EDGE_GUTTER_PX,
}: {
  itemLeft: number;
  itemWidth: number;
  scrollLeft: number;
  clientWidth: number;
  gutter?: number;
}): number {
  const alignLeft = () => itemLeft - gutter - scrollLeft;

  // Wider than the viewport: there is no scroll position that shows all of it,
  // so favour the leading edge instead of chasing the trailing one.
  if (itemWidth + gutter * 2 >= clientWidth) return alignLeft();

  if (itemLeft < scrollLeft + gutter) return alignLeft();

  const overflowRight = itemLeft + itemWidth - (scrollLeft + clientWidth - gutter);
  if (overflowRight > 0) return overflowRight;

  return 0;
}
