/**
 * 图块瘦身（LOD 简化）
 *  - 按图层 / 实体类型丢弃
 *  - 按最小线段长度 / 最小半径丢弃
 *  - Douglas-Peucker 折线简化
 *  - 整体替换为 bbox 矩形轮廓（最激进）
 *
 *  全部纯函数，便于在 worker 或主线程复用。
 */
import type { DxfEntity, SlimOptions } from "@ilp/schema";

export type EntityKind = DxfEntity["kind"];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/* ============== 统计 ============== */

export interface EntityStats {
  total: number;
  byKind: Record<EntityKind, number>;
  byLayer: Array<{ layer: string; count: number }>;
}

export function statEntities(entities: DxfEntity[]): EntityStats {
  const byKind: Record<EntityKind, number> = {
    line: 0,
    polyline: 0,
    arc: 0,
    circle: 0,
    text: 0,
  };
  const layerMap = new Map<string, number>();
  for (const e of entities) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const layer = e.layer ?? "(default)";
    layerMap.set(layer, (layerMap.get(layer) ?? 0) + 1);
  }
  const byLayer = Array.from(layerMap.entries())
    .map(([layer, count]) => ({ layer, count }))
    .sort((a, b) => b.count - a.count);
  return { total: entities.length, byKind, byLayer };
}

/* ============== RDP 折线简化 ============== */

/** Douglas-Peucker：points 是扁平 [x1,y1,x2,y2,...]，返回简化后的扁平数组 */
export function rdpSimplify(points: number[], epsilon: number): number[] {
  if (epsilon <= 0 || points.length < 6) return points;
  const n = points.length / 2;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const top = stack.pop();
    if (!top) break;
    const a = top[0];
    const b = top[1];
    let maxD = -1;
    let idx = -1;
    const ax = points[a * 2] ?? 0;
    const ay = points[a * 2 + 1] ?? 0;
    const bx = points[b * 2] ?? 0;
    const by = points[b * 2 + 1] ?? 0;
    for (let i = a + 1; i < b; i++) {
      const px = points[i * 2] ?? 0;
      const py = points[i * 2 + 1] ?? 0;
      const d = perpDist(px, py, ax, ay, bx, by);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx]);
      stack.push([idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) {
      out.push(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0);
    }
  }
  return out;
}

function perpDist(
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
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/* ============== 长度/范围工具 ============== */

function lineLen(points: number[]): number {
  if (points.length < 4) return 0;
  return Math.hypot((points[2] ?? 0) - (points[0] ?? 0), (points[3] ?? 0) - (points[1] ?? 0));
}
function polyTotalLen(points: number[]): number {
  let s = 0;
  for (let i = 2; i < points.length; i += 2) {
    s += Math.hypot(
      (points[i] ?? 0) - (points[i - 2] ?? 0),
      (points[i + 1] ?? 0) - (points[i - 1] ?? 0)
    );
  }
  return s;
}

/* ============== 主流程 ============== */

export interface SlimResult {
  entities: DxfEntity[];
  before: number;
  after: number;
}

export function slimEntities(
  entities: DxfEntity[],
  bbox: BBox,
  opts: SlimOptions
): SlimResult {
  const before = entities.length;

  if (opts.replaceWithBBox) {
    return { entities: bboxSilhouette(bbox), before, after: 4 };
  }

  const dropLayers = new Set(opts.dropLayers ?? []);
  const dropKinds = new Set(opts.dropKinds ?? []);
  const minSeg = opts.minSegmentLen ?? 0;
  const minR = opts.minRadius ?? 0;
  const eps = opts.rdpEpsilon ?? 0;

  const out: DxfEntity[] = [];
  for (const e of entities) {
    // 1) 图层 / 类型过滤
    if (dropKinds.has(e.kind)) continue;
    if (dropLayers.has(e.layer ?? "(default)")) continue;

    // 2) 尺寸过滤
    if (e.kind === "line") {
      if (minSeg > 0 && lineLen(e.points) < minSeg) continue;
      out.push(e);
      continue;
    }
    if (e.kind === "polyline") {
      if (minSeg > 0 && polyTotalLen(e.points) < minSeg) continue;
      const simplified =
        eps > 0 ? rdpSimplify(e.points, eps) : e.points;
      // 简化后只剩 1 点也丢
      if (simplified.length < 4) continue;
      out.push({ ...e, points: simplified });
      continue;
    }
    if (e.kind === "circle") {
      if (minR > 0 && e.r < minR) continue;
      out.push(e);
      continue;
    }
    if (e.kind === "arc") {
      if (minR > 0 && e.r < minR) continue;
      out.push(e);
      continue;
    }
    // text：只通过 dropKinds 控制
    out.push(e);
  }

  return { entities: out, before, after: out.length };
}

/** 用 bbox 矩形（4 条线）替代整个图块：极端 LOD */
export function bboxSilhouette(bbox: BBox): DxfEntity[] {
  const { minX, minY, maxX, maxY } = bbox;
  return [
    {
      kind: "polyline",
      points: [minX, minY, maxX, minY, maxX, maxY, minX, maxY],
      closed: true,
    },
  ];
}

/* ============== 预设 ============== */

export type SlimPreset = "light" | "medium" | "heavy" | "silhouette";

/**
 * 根据预设 + 图块尺寸推导参数。
 *  - 阈值与图块对角线挂钩，避免一刀切。
 */
export function presetOptions(preset: SlimPreset, bbox: BBox): SlimOptions {
  const diag = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) || 1000;
  switch (preset) {
    case "light":
      return {
        dropLayers: [],
        dropKinds: ["text"],
        minSegmentLen: diag * 0.002, // ~0.2% 对角线
        minRadius: diag * 0.002,
        rdpEpsilon: diag * 0.001,
        replaceWithBBox: false,
      };
    case "medium":
      return {
        dropLayers: [],
        dropKinds: ["text"],
        minSegmentLen: diag * 0.01,
        minRadius: diag * 0.01,
        rdpEpsilon: diag * 0.005,
        replaceWithBBox: false,
      };
    case "heavy":
      return {
        dropLayers: [],
        dropKinds: ["text", "circle", "arc"],
        minSegmentLen: diag * 0.03,
        minRadius: diag * 0.03,
        rdpEpsilon: diag * 0.015,
        replaceWithBBox: false,
      };
    case "silhouette":
      return {
        dropLayers: [],
        dropKinds: [],
        minSegmentLen: 0,
        minRadius: 0,
        rdpEpsilon: 0,
        replaceWithBBox: true,
      };
  }
}
