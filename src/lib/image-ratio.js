'use strict';

/**
 * The layout may only declare the aspect-ratio boxes listed here.
 *
 * A product photograph keeps its own ratio; the box is just the frame it is contained in, so
 * a box that is close to the source ratio keeps the empty space small. Adding a sixth ratio is
 * a deliberate act: register it here, in main.css and in the manifest rule block.
 */
const RATIO_CLASSES = [
  { className: '1x1', ratio: 1 },
  { className: '4x3', ratio: 4 / 3 },
  { className: '3x2', ratio: 3 / 2 },
  { className: '2x1', ratio: 2 },
  { className: '3x4', ratio: 3 / 4 },
];

const DEFAULT_RATIO_CLASS = '1x1';

/**
 * The frame follows the photograph itself.
 *
 * The previous v5 contract forced every card and hero into a 4:3 box. A 1:1 photograph then
 * overflowed the grid row and was clipped by `overflow:hidden`; a 2:1 photograph was contained
 * inside a much taller box and left a large band above and below. Both outcomes made the product
 * look incomplete or unnecessarily small.
 *
 * The frame is now the nearest registered ratio of the source photograph. The image is still
 * contained (never cropped or stretched); because the frame matches the source, the product can
 * use the available width/height without touching the frame edge.
 */
const PRESENTATION_RATIO_CLASS = null;
const CARD_RATIO_CLASS = '4x3';

/** Fallback frame colour, used only when a photograph has no sampled background yet. */
const DEFAULT_FRAME_BACKGROUND = '#ffffff';

function ratioClassFor(widthOrRatio, maybeHeight) {
  let ratio = Number(widthOrRatio);
  if (maybeHeight !== undefined) {
    const height = Number(maybeHeight);
    if (!height) return DEFAULT_RATIO_CLASS;
    ratio = Number(widthOrRatio) / height;
  }
  if (!Number.isFinite(ratio) || ratio <= 0) return DEFAULT_RATIO_CLASS;
  let best = DEFAULT_RATIO_CLASS;
  let bestDistance = Infinity;
  for (const entry of RATIO_CLASSES) {
    const distance = Math.abs(entry.ratio - ratio);
    if (distance < bestDistance) {
      best = entry.className;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Attach the presentation frame, the natural ratio class and the natural size to a product row so
 * templates never hardcode a width/height pair.
 *
 * `presentationRatioClass` is what the card and the hero render. `imageRatioClass` keeps the
 * ratio derived from the photograph itself, which the ratio audit and the manifest still use.
 */
function applyImageGeometry(row) {
  if (!row) return row;
  const ratio = Number(row.image_aspect_ratio);
  const width = Number(row.image_natural_width);
  const height = Number(row.image_natural_height);
  const naturalClass = Number.isFinite(ratio) && ratio > 0
    ? ratioClassFor(ratio)
    : (Number.isFinite(width) && Number.isFinite(height) && height > 0 ? ratioClassFor(width, height) : DEFAULT_RATIO_CLASS);
  const background = String(row.image_background_hex || '').match(/^#[0-9a-f]{6}$/i) ? row.image_background_hex : DEFAULT_FRAME_BACKGROUND;
  return {
    ...row,
    imageRatioClass: naturalClass,
    // The PDP main frame follows the photograph so a long towel bar can use the
    // full width. Cards keep one editorial 4:3 frame so a mixed catalogue still
    // produces an aligned grid; the image itself is contained in both cases.
    presentationRatioClass: naturalClass,
    cardRatioClass: CARD_RATIO_CLASS,
    frameBackground: background,
    imageNaturalWidth: Number.isFinite(width) && width > 0 ? width : null,
    imageNaturalHeight: Number.isFinite(height) && height > 0 ? height : null,
  };
}

module.exports = {
  RATIO_CLASSES,
  DEFAULT_RATIO_CLASS,
  PRESENTATION_RATIO_CLASS,
  CARD_RATIO_CLASS,
  DEFAULT_FRAME_BACKGROUND,
  ratioClassFor,
  applyImageGeometry,
};
