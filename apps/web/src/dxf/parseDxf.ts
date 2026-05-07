/**
 * DXF 解析（增强版）
 *  - 递归展开 INSERT 块引用 (核心：厂房 DXF 主要内容都在 BLOCK 表里)
 *  - 支持 LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE / TEXT / MTEXT / SOLID / 3DFACE
 *  - LWPOLYLINE bulge 弧段近似为折线
 *  - 单位换算：$INSUNITS → mm
 *  - 对每个 entity 应用 INSERT 链路上的 (translate, rotate, scale) 变换
 */
import DxfParser from "dxf-parser";
import type { DxfEntity } from "@ilp/schema";

const INSUNITS_TO_MM: Record<number, number> = {
  0: 1,
  1: 25.4, // inch
  2: 304.8, // foot
  4: 1, // mm
  5: 10, // cm
  6: 1000, // m
};

/** 2D 仿射变换矩阵 [a c tx; b d ty; 0 0 1] */
interface Tx {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}
const ID: Tx = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function applyTx(t: Tx, x: number, y: number): [number, number] {
  return [t.a * x + t.c * y + t.tx, t.b * x + t.d * y + t.ty];
}
function compose(outer: Tx, inner: Tx): Tx {
  // outer * inner
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
}
function makeTx(opts: { tx?: number; ty?: number; rotDeg?: number; sx?: number; sy?: number }): Tx {
  const sx = opts.sx ?? 1;
  const sy = opts.sy ?? 1;
  const r = ((opts.rotDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    a: cos * sx,
    b: sin * sx,
    c: -sin * sy,
    d: cos * sy,
    tx: opts.tx ?? 0,
    ty: opts.ty ?? 0,
  };
}
/** 提取 t 中的均匀缩放因子（用于 r/text height 之类标量） */
function txScale(t: Tx): number {
  return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
}

export type DxfProgressPhase = "read" | "parse" | "expand" | "done";
export interface DxfProgress {
  phase: DxfProgressPhase;
  /** 当前已处理实体数（expand 阶段递增） */
  processed: number;
  /** 顶层 entities 数（已知总数） */
  topLevelTotal: number;
  /** 已展开的 INSERT 数 */
  insertsExpanded: number;
  /** 文件大小 bytes（read 阶段） */
  fileBytes?: number;
  message?: string;
}
export type DxfProgressCallback = (p: DxfProgress) => void;

export interface ParsedDxf {
  entities: DxfEntity[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  unitScale: number;
  /** 解析摘要：每种 DXF 实体类型出现次数 */
  stats: Record<string, number>;
  /** 已忽略的实体类型 */
  ignored: Record<string, number>;
  /** 展开的 INSERT 数 */
  insertsExpanded: number;
  /** 引用了但未在 BLOCKS 表中找到的块名 */
  missingBlocks: string[];
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function parseDxfFile(
  file: File,
  onProgress?: DxfProgressCallback
): Promise<ParsedDxf> {
  onProgress?.({
    phase: "read",
    processed: 0,
    topLevelTotal: 0,
    insertsExpanded: 0,
    fileBytes: file.size,
    message: `读取文件 ${(file.size / 1024).toFixed(0)} KB`,
  });
  await yieldToUi();
  const text = await file.text();

  onProgress?.({
    phase: "parse",
    processed: 0,
    topLevelTotal: 0,
    insertsExpanded: 0,
    fileBytes: file.size,
    message: "解析 DXF 结构（同步阶段，文件大可能卡顿）...",
  });
  await yieldToUi();

  const parser = new DxfParser();
  let dxf: any;
  try {
    dxf = parser.parseSync(text);
  } catch (e) {
    throw new Error(`DXF 解析失败: ${(e as Error).message}`);
  }
  if (!dxf) throw new Error("DXF 解析返回空");

  const insunits = dxf.header?.$INSUNITS ?? 0;
  const unitScale = INSUNITS_TO_MM[insunits] ?? 1;

  const blocks: Record<string, any> = dxf.blocks ?? {};
  const out: DxfEntity[] = [];
  const stats: Record<string, number> = {};
  const ignored: Record<string, number> = {};
  const missingBlocks = new Set<string>();
  let insertsExpanded = 0;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const expand = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  // 全局：先把 modelspace 单位放大（在变换最外层乘 unitScale）
  const rootTx = makeTx({ sx: unitScale, sy: unitScale });

  // 防止循环引用
  const visiting = new Set<string>();

  const topLevelTotal = (dxf.entities ?? []).length;
  let processedCount = 0;
  const PROGRESS_BATCH = 1500;
  let nextYieldAt = PROGRESS_BATCH;

  const processEntities = async (ents: any[], tx: Tx, depth: number): Promise<void> => {
    if (depth > 8) return; // 安全护栏
    for (const e of ents ?? []) {
      await processEntity(e, tx, depth);
    }
  };

  const processEntity = async (e: any, tx: Tx, depth: number): Promise<void> => {
    processedCount++;
    if (processedCount >= nextYieldAt) {
      nextYieldAt += PROGRESS_BATCH;
      onProgress?.({
        phase: "expand",
        processed: processedCount,
        topLevelTotal,
        insertsExpanded,
        message: `处理实体 ${processedCount}（INSERT 已展开 ${insertsExpanded}）`,
      });
      await yieldToUi();
    }
    const type = e.type as string;
    stats[type] = (stats[type] ?? 0) + 1;
    const layer = e.layer as string | undefined;
    const s = txScale(tx);

    switch (type) {
      case "LINE": {
        const [x1, y1] = applyTx(tx, e.vertices?.[0]?.x ?? 0, e.vertices?.[0]?.y ?? 0);
        const [x2, y2] = applyTx(tx, e.vertices?.[1]?.x ?? 0, e.vertices?.[1]?.y ?? 0);
        out.push({ kind: "line", points: [x1, y1, x2, y2], layer });
        expand(x1, y1);
        expand(x2, y2);
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const verts = e.vertices ?? [];
        const pts: number[] = [];
        for (let i = 0; i < verts.length; i++) {
          const v = verts[i];
          const [x, y] = applyTx(tx, v.x ?? 0, v.y ?? 0);
          pts.push(x, y);
          expand(x, y);

          // 处理 bulge（弧段）：在 v 与 next 之间加密
          const bulge = v.bulge ?? 0;
          if (bulge !== 0 && i < verts.length - 1) {
            const v2 = verts[i + 1];
            const [x1, y1] = applyTx(tx, v.x ?? 0, v.y ?? 0);
            const [x2, y2] = applyTx(tx, v2.x ?? 0, v2.y ?? 0);
            const arcPts = sampleBulge(x1, y1, x2, y2, bulge, 16);
            for (let k = 0; k < arcPts.length; k += 2) {
              const ax = arcPts[k]!;
              const ay = arcPts[k + 1]!;
              pts.push(ax, ay);
              expand(ax, ay);
            }
          }
        }
        if (pts.length >= 4) {
          out.push({
            kind: "polyline",
            points: pts,
            closed: !!e.shape || !!e.closed,
            layer,
          });
        }
        break;
      }
      case "CIRCLE": {
        const [cx, cy] = applyTx(tx, e.center?.x ?? 0, e.center?.y ?? 0);
        const r = (e.radius ?? 0) * s;
        out.push({ kind: "circle", cx, cy, r, layer });
        expand(cx - r, cy - r);
        expand(cx + r, cy + r);
        break;
      }
      case "ARC": {
        // ARC 旋转受 tx 旋转影响：sample 成 polyline 更稳
        const cxL = e.center?.x ?? 0;
        const cyL = e.center?.y ?? 0;
        const r = e.radius ?? 0;
        const sa = ((e.startAngle ?? 0) * Math.PI) / 180;
        const ea = ((e.endAngle ?? 0) * Math.PI) / 180;
        const pts = sampleArc(cxL, cyL, r, sa, ea, 32);
        const transformed: number[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          const [x, y] = applyTx(tx, pts[i]!, pts[i + 1]!);
          transformed.push(x, y);
          expand(x, y);
        }
        out.push({ kind: "polyline", points: transformed, closed: false, layer });
        break;
      }
      case "ELLIPSE": {
        // dxf-parser: center, majorAxisEndPoint(相对于 center), axisRatio, startAngle/endAngle (param)
        const cxL = e.center?.x ?? 0;
        const cyL = e.center?.y ?? 0;
        const mx = e.majorAxisEndPoint?.x ?? 0;
        const my = e.majorAxisEndPoint?.y ?? 0;
        const ratio = e.axisRatio ?? 1;
        const a = Math.hypot(mx, my);
        const b = a * ratio;
        const phi = Math.atan2(my, mx);
        const t0 = e.startAngle ?? 0;
        const t1 = e.endAngle ?? Math.PI * 2;
        const segs = 64;
        const dt = (t1 - t0) / segs;
        const transformed: number[] = [];
        for (let i = 0; i <= segs; i++) {
          const t = t0 + dt * i;
          const lx = cxL + a * Math.cos(t) * Math.cos(phi) - b * Math.sin(t) * Math.sin(phi);
          const ly = cyL + a * Math.cos(t) * Math.sin(phi) + b * Math.sin(t) * Math.cos(phi);
          const [x, y] = applyTx(tx, lx, ly);
          transformed.push(x, y);
          expand(x, y);
        }
        out.push({
          kind: "polyline",
          points: transformed,
          closed: Math.abs(t1 - t0 - Math.PI * 2) < 1e-3,
          layer,
        });
        break;
      }
      case "SPLINE": {
        // 使用控制点或拟合点作为折线近似（对底图视觉参考够用）
        const fp = e.fitPoints ?? [];
        const cp = e.controlPoints ?? [];
        const src = fp.length > 0 ? fp : cp;
        if (src.length < 2) break;
        const transformed: number[] = [];
        for (const v of src) {
          const [x, y] = applyTx(tx, v.x ?? 0, v.y ?? 0);
          transformed.push(x, y);
          expand(x, y);
        }
        out.push({ kind: "polyline", points: transformed, closed: !!e.closed, layer });
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const [x, y] = applyTx(tx, e.startPoint?.x ?? e.position?.x ?? 0, e.startPoint?.y ?? e.position?.y ?? 0);
        const height = (e.textHeight ?? e.height ?? 100) * s;
        const rotation = (e.rotation ?? 0) + Math.atan2(tx.b, tx.a) * (180 / Math.PI);
        const txt = (e.text ?? "").toString();
        if (txt) {
          out.push({ kind: "text", x, y, text: txt, height, rotation, layer });
          expand(x, y);
          expand(x + txt.length * height * 0.6, y + height);
        }
        break;
      }
      case "SOLID":
      case "3DFACE": {
        const verts = [e.points?.[0], e.points?.[1], e.points?.[3], e.points?.[2]].filter(Boolean);
        // SOLID/3DFACE 顶点 0,1,3,2 顺序构成四边形
        const pts: number[] = [];
        for (const v of verts) {
          if (!v) continue;
          const [x, y] = applyTx(tx, v.x ?? 0, v.y ?? 0);
          pts.push(x, y);
          expand(x, y);
        }
        if (pts.length >= 6) {
          out.push({ kind: "polyline", points: pts, closed: true, layer });
        }
        break;
      }
      case "INSERT": {
        const blockName = e.name as string;
        const blk = blocks[blockName];
        if (!blk) {
          missingBlocks.add(blockName);
          break;
        }
        if (visiting.has(blockName)) break; // 循环引用保护
        visiting.add(blockName);
        insertsExpanded++;

        // INSERT 局部变换：先按 block.position(基点) 平移到原点，再缩放，再旋转，最后平移到插入点
        const ix = e.position?.x ?? 0;
        const iy = e.position?.y ?? 0;
        const xs = e.xScale ?? 1;
        const ys = e.yScale ?? 1;
        const rot = e.rotation ?? 0;
        const bx = blk.position?.x ?? 0;
        const by = blk.position?.y ?? 0;

        const tInsert = compose(
          makeTx({ tx: ix, ty: iy, rotDeg: rot, sx: xs, sy: ys }),
          makeTx({ tx: -bx, ty: -by })
        );
        const newTx = compose(tx, tInsert);

        // ARRAY (column/row count) — 简化处理：只处理 1×1，复杂阵列暂忽略
        const colCount = e.columnCount ?? 1;
        const rowCount = e.rowCount ?? 1;
        const colSpacing = e.columnSpacing ?? 0;
        const rowSpacing = e.rowSpacing ?? 0;
        for (let r = 0; r < rowCount; r++) {
          for (let c = 0; c < colCount; c++) {
            const arrayTx =
              colCount === 1 && rowCount === 1
                ? newTx
                : compose(
                    tx,
                    compose(
                      makeTx({ tx: ix + c * colSpacing, ty: iy + r * rowSpacing, rotDeg: rot, sx: xs, sy: ys }),
                      makeTx({ tx: -bx, ty: -by })
                    )
                  );
            await processEntities(blk.entities ?? [], arrayTx, depth + 1);
          }
        }
        visiting.delete(blockName);
        break;
      }
      default:
        ignored[type] = (ignored[type] ?? 0) + 1;
        break;
    }
  };

  onProgress?.({
    phase: "expand",
    processed: 0,
    topLevelTotal,
    insertsExpanded: 0,
    message: `开始展开实体（顶层 ${topLevelTotal} 个）`,
  });
  await yieldToUi();

  await processEntities(dxf.entities ?? [], rootTx, 0);

  onProgress?.({
    phase: "done",
    processed: processedCount,
    topLevelTotal,
    insertsExpanded,
    message: `完成：${out.length} 个图元`,
  });

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }

  return {
    entities: out,
    bbox: { minX, minY, maxX, maxY },
    unitScale,
    stats,
    ignored,
    insertsExpanded,
    missingBlocks: [...missingBlocks],
  };
}

/** 在 (cx,cy) 半径 r 上从 sa 到 ea（弧度）采样点，输出 [x0,y0,x1,y1,...] */
function sampleArc(cx: number, cy: number, r: number, sa: number, ea: number, segs: number): number[] {
  let span = ea - sa;
  // 规范化跨度到 [0, 2π]
  if (span < 0) span += Math.PI * 2;
  if (span === 0) span = Math.PI * 2;
  const out: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = sa + (span * i) / segs;
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  return out;
}

/**
 * Bulge 弧段采样
 *  bulge = tan(includedAngle / 4)
 *  正值=逆时针，负值=顺时针
 */
function sampleBulge(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulge: number,
  segs: number
): number[] {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(x2 - x1, y2 - y1);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // 垂直于弦的方向
  const nx = -(y2 - y1) / chord;
  const ny = (x2 - x1) / chord;
  const sagitta = r - r * Math.cos(theta / 2);
  const sign = bulge > 0 ? 1 : -1;
  const cx = mx + nx * (r - sagitta) * sign;
  const cy = my + ny * (r - sagitta) * sign;
  const sa = Math.atan2(y1 - cy, x1 - cx);
  const ea = sa + theta;
  const out: number[] = [];
  for (let i = 1; i <= segs; i++) {
    const t = sa + ((ea - sa) * i) / segs;
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  return out;
}
