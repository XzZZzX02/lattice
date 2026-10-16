import { describe, expect, it } from "vitest";
import { positionTreeCard } from "./tree-floating";

describe("reference-anchored floating placement", () => {
  it("uses the free side without covering the quoted text or workspace", () => {
    const anchor = { left: 300, right: 360, top: 200, bottom: 220 };
    const position = positionTreeCard(anchor, { width: 1440, height: 900, right: 1080 });
    expect(position.left).toBeGreaterThan(anchor.right);
    expect(position.left + position.width).toBeLessThan(1080);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(900);
  });
  it("keeps the reference visible above the card on a narrow screen", () => {
    const anchor = { left: 320, right: 390, top: 240, bottom: 260 };
    const position = positionTreeCard(anchor, { width: 560, height: 742 }, 560);
    expect(position.top).toBeGreaterThan(anchor.bottom);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(730);
    expect(position.left + position.width).toBeLessThanOrEqual(548);
  });
  it("stays within a resized viewport even if the original reference is offscreen", () => {
    const position = positionTreeCard({ left: 1400, right: 1500, top: 800, bottom: 820 }, { width: 320, height: 400 });
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.left + position.width).toBeLessThanOrEqual(308);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + Math.min(460, position.maxHeight)).toBeLessThanOrEqual(388);
  });
});
