export const PANEL_WIDTH_KEY = "lattice:panel-width:v1";
export const DEFAULT_PANEL_WIDTH = 340;
export const MIN_PANEL_WIDTH = 280;
export const MAX_PANEL_WIDTH = 820;

export function readPanelWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, value)))
    : null;
}

export function panelLayout(viewportWidth: number, contentLeft: number, preferredWidth: number, wide = false) {
  // Keep enough room for the native conversation, including its own sidebar.
  const available = viewportWidth - Math.max(0, contentLeft) - 480 - 24;
  const compact = viewportWidth < 900 || available < MIN_PANEL_WIDTH;
  const maxWidth = Math.max(0, compact
    ? Math.min(520, viewportWidth - 16)
    : Math.min(MAX_PANEL_WIDTH, available, Math.floor(viewportWidth * 0.42)));
  const minWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
  const width = wide ? maxWidth : Math.min(maxWidth, Math.max(minWidth, preferredWidth));
  return { compact, minWidth, maxWidth, width };
}
