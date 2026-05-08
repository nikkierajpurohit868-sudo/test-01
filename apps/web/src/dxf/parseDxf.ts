/**
 * DXF 解析 + 图块抽取
 *  - parseDxfFile/parseDxfText: 完整解析整张图（展开所有 INSERT），用于底图
 *  - extractDxfBlocks: 仅提取 BLOCK 表里的定义（坐标平移到块基点为原点），用于建库
 *  - 支持 LINE / LWPOLYLINE / POLYLINE / CIRCLE / ARC / ELLIPSE / SPLINE / TEXT / MTEXT / SOLID / 3DFACE
 *  - LWPOLYLINE bulge 弧段近似为折线
 *  - 主线程入口优先走 Web Worker，失败时降级同步解析
 */
import DxfParser from "dxf-parser";
import type { DxfEntity } from "@ilp/schema";

const INSUNITS_TO_MM: Record<number, number> = {
  0: 1,
  1: 25.4,
  2: 304.8,
  4: 1,
  5: 10,
  6: 1000,
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

function applyTx(t: Tx, x: number, y: number): [number, number] {
  return [t.a * x + t.c * y + t.tx, t.b * x + t.d * y + t.ty];
}
function compose(outer: Tx, inner: Tx): Tx {
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
function txScale(t: Tx): number {
  return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c));
}

export type DxfProgressPhase = "read" | "parse" | "expand" | "extract" | "done";
export interface DxfProgress {
  phase: DxfProgressPhase;
  processed: number;
  topLevelTotal: number;
  insertsExpanded: number;
  fileBytes?: number;
  message?: string;
}
export type DxfProgressCallback = (p: DxfProgress) => void;

export interface ParsedDxf {
  entities: DxfEntity[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  unitScale: number;
  stats: Record<string, number>;
  ignored: Record<string, number>;
  insertsExpanded: number;
  missingBlocks: string[];
}

export interface ExtractedBlock {
  /** 原始 BLOCK 名 */
  name: string;
  entities: DxfEntity[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** 包含的实体计数（按类型） */
  stats: Record<string, number>;
  insertsExpanded: number;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/* ============================================================
 *  Entity Processor 工厂：复用 entity → DxfEntity 转换的核心逻辑
 * ============================================================ */

interface ProcessorState {
  out: DxfEntity[];
  stats: Record<string, number>;
  ignored: Record<string, number>;
  missingBlocks: Set<string>;
  insertsExpanded: number;
  processedCount: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Processor {
  state: ProcessorState;
  /** 处理一组实体，应用变换矩阵 */
  processEntities: (ents: any[], tx: Tx, depth: number) => Promise<void>;
  /** 获取最终 bbox（无穷大归零） */
  finalBBox: () => { minX: number; minY: number; maxX: number; maxY: number };
}

function createProcessor(blocks: Record<string, any>, onYield?: () => Promise<void>): Processor {
  const state: ProcessorState = {
    out: [],
    stats: {},
    ignored: {},
    missingBlocks: new Set<string>(),
    insertsExpanded: 0,
    processedCount: 0,
    bbox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  };
  const visiting = new Set<string>();
  const PROGRESS_BATCH = 1500;
  let nextYieldAt = PROGRESS_BATCH;

  const expand = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < state.bbox.minX) state.bbox.minX = x;
    if (y < state.bbox.minY) state.bbox.minY = y;
    if (x > state.bbox.maxX) state.bbox.maxX = x;
    if (y > state.bbox.maxY) state.bbox.maxY = y;
  };

  const processEntities = async (ents: any[], tx: Tx, depth: number): Promise<void> => {
    if (depth > 8) return;
    for (const e of ents ?? []) {
      await processEntity(e, tx, depth);
    }
  };

  const processEntity = async (e: any, tx: Tx, depth: number): Promise<void> => {
    state.processedCount++;
    if (state.processedCount >= nextYieldAt) {
      nextYieldAt += PROGRESS_BATCH;
      if (onYield) await onYield();
    }
    const type = e.type as string;
    state.stats[type] = (state.stats[type] ?? 0) + 1;
    const layer = e.layer as string | undefined;
    const s = txScale(tx);

    switch (type) {
      case "LINE": {
        const [x1, y1] = applyTx(tx, e.vertices?.[0]?.x ?? 0, e.vertices?.[0]?.y ?? 0);
        const [x2, y2] = applyTx(tx, e.vertices?.[1]?.x ?? 0, e.vertices?.[1]?.y ?? 0);
        state.out.push({ kind: "line", points: [x1, y1, x2, y2], layer });
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
          const bulge = v.bulge ?? 0;
          if (bulge !== 0 && i < verts.length - 1) {
            const v2 = verts[i + 1];
            const [bx1, by1] = applyTx(tx, v.x ?? 0, v.y ?? 0);
            const [bx2, by2] = applyTx(tx, v2.x ?? 0, v2.y ?? 0);
            const arcPts = sampleBulge(bx1, by1, bx2, by2, bulge, 16);
            for (let k = 0; k < arcPts.length; k += 2) {
              const ax = arcPts[k]!;
              const ay = arcPts[k + 1]!;
              pts.push(ax, ay);
              expand(ax, ay);
            }
          }
        }
        if (pts.length >= 4) {
          state.out.push({
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
        state.out.push({ kind: "circle", cx, cy, r, layer });
        expand(cx - r, cy - r);
        expand(cx + r, cy + r);
        break;
      }
      case "ARC": {
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
        state.out.push({ kind: "polyline", points: transformed, closed: false, layer });
        break;
      }
      case "ELLIPSE": {
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
        state.out.push({
          kind: "polyline",
          points: transformed,
          closed: Math.abs(t1 - t0 - Math.PI * 2) < 1e-3,
          layer,
        });
        break;
      }
      case "SPLINE": {
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
        state.out.push({ kind: "polyline", points: transformed, closed: !!e.closed, layer });
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const [x, y] = applyTx(
          tx,
          e.startPoint?.x ?? e.position?.x ?? 0,
          e.startPoint?.y ?? e.position?.y ?? 0
        );
        const height = (e.textHeight ?? e.height ?? 100) * s;
        const rotation = (e.rotation ?? 0) + Math.atan2(tx.b, tx.a) * (180 / Math.PI);
        const txt = (e.text ?? "").toString();
        if (txt) {
          state.out.push({ kind: "text", x, y, text: txt, height, rotation, layer });
          expand(x, y);
          expand(x + txt.length * height * 0.6, y + height);
        }
        break;
      }
      case "SOLID":
      case "3DFACE": {
        const verts = [e.points?.[0], e.points?.[1], e.points?.[3], e.points?.[2]].filter(Boolean);
        const pts: number[] = [];
        for (const v of verts) {
          if (!v) continue;
          const [x, y] = applyTx(tx, v.x ?? 0, v.y ?? 0);
          pts.push(x, y);
          expand(x, y);
        }
        if (pts.length >= 6) {
          state.out.push({ kind: "polyline", points: pts, closed: true, layer });
        }
        break;
      }
      case "INSERT": {
        const blockName = e.name as string;
        const blk = blocks[blockName];
        if (!blk) {
          state.missingBlocks.add(blockName);
          break;
        }
        if (visiting.has(blockName)) break;
        visiting.add(blockName);
        state.insertsExpanded++;

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
                      makeTx({
                        tx: ix + c * colSpacing,
                        ty: iy + r * rowSpacing,
                        rotDeg: rot,
                        sx: xs,
                        sy: ys,
                      }),
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
        state.ignored[type] = (state.ignored[type] ?? 0) + 1;
        break;
    }
  };

  const finalBBox = () => {
    const b = state.bbox;
    if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    return { ...b };
  };

  return { state, processEntities, finalBBox };
}

/* ============================================================
 *  完整解析（用作底图）
 * ============================================================ */

/**
 * 主线程入口：自动用 Web Worker 解析（不卡 UI）；Worker 失败时降级同步
 */
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
    message: `读取文件 ${(file.size / 1024 / 1024).toFixed(1)} MB`,
  });
  const text = await file.text();

  try {
    return await parseDxfTextInWorker(text, file.size, onProgress);
  } catch (e) {
    console.warn("[dxf] worker 失败，回退主线程同步解析:", e);
    return parseDxfText(text, file.size, onProgress);
  }
}

function parseDxfTextInWorker(
  text: string,
  fileSize: number,
  onProgress?: DxfProgressCallback
): Promise<ParsedDxf> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./dxfWorker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      reject(e);
      return;
    }
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === "progress") onProgress?.(m.payload);
      else if (m.type === "done") {
        worker.terminate();
        resolve(m.payload as ParsedDxf);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "worker error"));
    };
    worker.postMessage({ type: "parseFull", text, fileSize });
  });
}

export async function parseDxfText(
  text: string,
  fileSize: number,
  onProgress?: DxfProgressCallback
): Promise<ParsedDxf> {
  onProgress?.({
    phase: "parse",
    processed: 0,
    topLevelTotal: 0,
    insertsExpanded: 0,
    fileBytes: fileSize,
    message: "解析 DXF 结构...",
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
  const topLevelTotal = (dxf.entities ?? []).length;

  const proc = createProcessor(blocks, async () => {
    onProgress?.({
      phase: "expand",
      processed: proc.state.processedCount,
      topLevelTotal,
      insertsExpanded: proc.state.insertsExpanded,
      message: `处理实体 ${proc.state.processedCount}（INSERT 已展开 ${proc.state.insertsExpanded}）`,
    });
    await yieldToUi();
  });

  onProgress?.({
    phase: "expand",
    processed: 0,
    topLevelTotal,
    insertsExpanded: 0,
    message: `开始展开实体（顶层 ${topLevelTotal} 个）`,
  });
  await yieldToUi();

  const rootTx = makeTx({ sx: unitScale, sy: unitScale });
  await proc.processEntities(dxf.entities ?? [], rootTx, 0);

  onProgress?.({
    phase: "done",
    processed: proc.state.processedCount,
    topLevelTotal,
    insertsExpanded: proc.state.insertsExpanded,
    message: `完成：${proc.state.out.length} 个图元`,
  });

  return {
    entities: proc.state.out,
    bbox: proc.finalBBox(),
    unitScale,
    stats: proc.state.stats,
    ignored: proc.state.ignored,
    insertsExpanded: proc.state.insertsExpanded,
    missingBlocks: [...proc.state.missingBlocks],
  };
}

/* ============================================================
 *  图块抽取（用作建库）
 * ============================================================ */

export interface ExtractBlocksResult {
  blocks: ExtractedBlock[];
  unitScale: number;
  /** 跳过的块数（系统块、空块） */
  skipped: number;
  /** 来源文件名 */
  sourceFile: string;
}

export async function extractDxfBlocksFromFile(
  file: File,
  onProgress?: DxfProgressCallback
): Promise<ExtractBlocksResult> {
  onProgress?.({
    phase: "read",
    processed: 0,
    topLevelTotal: 0,
    insertsExpanded: 0,
    fileBytes: file.size,
    message: `读取文件 ${(file.size / 1024 / 1024).toFixed(1)} MB`,
  });
  const text = await file.text();

  try {
    return await extractDxfBlocksInWorker(text, file.size, file.name, onProgress);
  } catch (e) {
    console.warn("[dxf] worker 失败，回退主线程提取:", e);
    return extractDxfBlocksText(text, file.size, file.name, onProgress);
  }
}

function extractDxfBlocksInWorker(
  text: string,
  fileSize: number,
  fileName: string,
  onProgress?: DxfProgressCallback
): Promise<ExtractBlocksResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./dxfWorker.ts", import.meta.url), { type: "module" });
    } catch (e) {
      reject(e);
      return;
    }
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === "progress") onProgress?.(m.payload);
      else if (m.type === "done") {
        worker.terminate();
        resolve(m.payload as ExtractBlocksResult);
      } else if (m.type === "error") {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error(ev.message || "worker error"));
    };
    worker.postMessage({ type: "extractBlocks", text, fileSize, fileName });
  });
}

export async function extractDxfBlocksText(
  text: string,
  fileSize: number,
  fileName: string,
  onProgress?: DxfProgressCallback
): Promise<ExtractBlocksResult> {
  onProgress?.({
    phase: "parse",
    processed: 0,
    topLevelTotal: 0,
    insertsExpanded: 0,
    fileBytes: fileSize,
    message: "解析 DXF 结构...",
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
  const blockNames = Object.keys(blocks).filter((n) => !n.startsWith("*"));
  const totalBlocks = blockNames.length;

  onProgress?.({
    phase: "extract",
    processed: 0,
    topLevelTotal: totalBlocks,
    insertsExpanded: 0,
    message: `开始抽取 ${totalBlocks} 个块定义`,
  });
  await yieldToUi();

  const result: ExtractedBlock[] = [];
  let skipped = 0;
  let i = 0;

  for (const name of blockNames) {
    i++;
    const blk = blocks[name];
    if (!blk?.entities || blk.entities.length === 0) {
      skipped++;
      continue;
    }

    // 单块独立 processor：rootTx 把块基点平移到原点 + 单位换算
    const proc = createProcessor(blocks);
    const bx = blk.position?.x ?? 0;
    const by = blk.position?.y ?? 0;
    const rootTx = compose(makeTx({ sx: unitScale, sy: unitScale }), makeTx({ tx: -bx, ty: -by }));

    try {
      await proc.processEntities(blk.entities, rootTx, 0);
    } catch (e) {
      console.warn(`[dxf] 块 ${name} 处理失败:`, e);
      skipped++;
      continue;
    }

    if (proc.state.out.length === 0) {
      skipped++;
      continue;
    }

    result.push({
      name,
      entities: proc.state.out,
      bbox: proc.finalBBox(),
      stats: proc.state.stats,
      insertsExpanded: proc.state.insertsExpanded,
    });

    if (i % 25 === 0) {
      onProgress?.({
        phase: "extract",
        processed: i,
        topLevelTotal: totalBlocks,
        insertsExpanded: 0,
        message: `已抽取 ${result.length}/${i}（跳过 ${skipped}）`,
      });
      await yieldToUi();
    }
  }

  onProgress?.({
    phase: "done",
    processed: i,
    topLevelTotal: totalBlocks,
    insertsExpanded: 0,
    message: `完成：${result.length} 个有效图块（跳过 ${skipped}）`,
  });

  return { blocks: result, unitScale, skipped, sourceFile: fileName };
}

/* ============================================================
 *  几何采样工具
 * ============================================================ */

function sampleArc(cx: number, cy: number, r: number, sa: number, ea: number, segs: number): number[] {
  let span = ea - sa;
  if (span < 0) span += Math.PI * 2;
  if (span === 0) span = Math.PI * 2;
  const out: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = sa + (span * i) / segs;
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  return out;
}

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
