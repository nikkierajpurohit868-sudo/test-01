/**
 * 实体命中测试（用于橡皮擦/框选擦除）
 * 所有坐标单位 mm
 */
import type { DxfEntity } from "@ilp/schema";

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 计算实体的轴对齐包围盒 */
export function entityBBox(e: DxfEntity): BBox {
  switch (e.kind) {
    case "line":
    case "polyline": {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      const pts = e.points;
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i] ?? 0;
        const y = pts[i + 1] ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return { minX, minY, maxX, maxY };
    }
    case "circle":
    case "arc":
      return {
        minX: e.cx - e.r,
        minY: e.cy - e.r,
        maxX: e.cx + e.r,
        maxY: e.cy + e.r,
      };
    case "text": {
      // 粗略估计字宽
      const w = Math.max(1, e.text.length) * e.height * 0.6;
      return { minX: e.x, minY: e.y, maxX: e.x + w, maxY: e.y + e.height };
    }
  }
}

/** 点到线段距离 */
function pointToSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** 点到实体的最短距离（mm）；用于橡皮擦命中判断 */
export function pointToEntityDist(e: DxfEntity, px: number, py: number): number {
  switch (e.kind) {
    case "line": {
      const p = e.points;
      return pointToSeg(px, py, p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0);
    }
    case "polyline": {
      const p = e.points;
      let min = Infinity;
      for (let i = 0; i < p.length - 2; i += 2) {
        const d = pointToSeg(
          px,
          py,
          p[i] ?? 0,
          p[i + 1] ?? 0,
          p[i + 2] ?? 0,
          p[i + 3] ?? 0
        );
        if (d < min) min = d;
      }
      // 闭合则连首尾
      if (e.closed && p.length >= 4) {
        const last = p.length - 2;
        const d = pointToSeg(
          px,
          py,
          p[last] ?? 0,
          p[last + 1] ?? 0,
          p[0] ?? 0,
          p[1] ?? 0
        );
        if (d < min) min = d;
      }
      return min;
    }
    case "circle":
    case "arc":
      return Math.abs(Math.hypot(px - e.cx, py - e.cy) - e.r);
    case "text": {
      const b = entityBBox(e);
      // 距离 bbox（在内为 0）
      const dx = Math.max(b.minX - px, 0, px - b.maxX);
      const dy = Math.max(b.minY - py, 0, py - b.maxY);
      return Math.hypot(dx, dy);
    }
  }
}

/** 矩形是否与实体相交（基于 bbox 近似，效率优先） */
export function rectIntersectsEntity(e: DxfEntity, r: BBox): boolean {
  const b = entityBBox(e);
  return !(b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY);
}

/** 实体 bbox 是否完全包含于矩形（用于"严格框选"模式） */
export function rectContainsEntity(e: DxfEntity, r: BBox): boolean {
  const b = entityBBox(e);
  return b.minX >= r.minX && b.minY >= r.minY && b.maxX <= r.maxX && b.maxY <= r.maxY;
}

/** 规范化矩形（保证 min < max） */
export function normRect(r: BBox): BBox {
  return {
    minX: Math.min(r.minX, r.maxX),
    minY: Math.min(r.minY, r.maxY),
    maxX: Math.max(r.minX, r.maxX),
    maxY: Math.max(r.minY, r.maxY),
  };
}
