export interface SelectionAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Size {
  width: number;
  height: number;
}

const TOOLBAR_SIZE = { width: 156, height: 42 };
const VIEWPORT_MARGIN = 8;
const SELECTION_GAP = 8;

export function positionFloatingToolbar(
  anchor: SelectionAnchor,
  viewport: Size,
  toolbar: Size = TOOLBAR_SIZE
): { left: number; top: number } {
  const center = (anchor.left + anchor.right) / 2;
  const maximumLeft = Math.max(VIEWPORT_MARGIN, viewport.width - toolbar.width - VIEWPORT_MARGIN);
  const left = clamp(center - toolbar.width / 2, VIEWPORT_MARGIN, maximumLeft);
  const preferredTop = anchor.top - toolbar.height - SELECTION_GAP;
  const belowTop = anchor.bottom + SELECTION_GAP;
  const maximumTop = Math.max(VIEWPORT_MARGIN, viewport.height - toolbar.height - VIEWPORT_MARGIN);
  const top = clamp(
    preferredTop >= VIEWPORT_MARGIN ? preferredTop : belowTop,
    VIEWPORT_MARGIN,
    maximumTop
  );
  return { left, top };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
