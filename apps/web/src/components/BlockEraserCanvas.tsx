/**
 * 图块橡皮擦画布：全屏模态
 *  工具：
 *    - pan        平移/缩放
 *    - brush      橡皮擦笔刷（拖动删除半径内实体）
 *    - rectErase  框选擦除
 *    - rectSlim   框选 + 自动瘦身（仅区域内）
 *  撤销/重置/应用 一气呵成。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Group, Line as KLine, Rect as KRect, Circle as KCircle } from "react-konva";
import {
  X,
  Eraser,
  BoxSelect,
  Zap,
  Move,
  Undo2,
  RotateCcw,
  Save,
} from "lucide-react";
import type { DxfEntity } from "@ilp/schema";
import { useProjectStore } from "@/store/projectStore";
import { EntityNode } from "@/canvas/DxfBackgroundLayer";
import {
  pointToEntityDist,
  rectIntersectsEntity,
  normRect,
  type BBox,
} from "@/lib/entityHit";
import { slimEntities, presetOptions, type SlimPreset } from "@/lib/slimBlock";

type Tool = "pan" | "brush" | "rectErase" | "rectSlim";

interface View {
  s: number; // px / mm
  tx: number; // px
  ty: number; // px
}

function fitView(bbox: BBox, w: number, h: number, pad = 40): View {
  const bw = Math.max(1, bbox.maxX - bbox.minX);
  const bh = Math.max(1, bbox.maxY - bbox.minY);
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  // 世界中心 -> 屏幕中心；Y 轴翻转
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return {
    s,
    tx: w / 2 - cx * s,
    ty: h / 2 + cy * s,
  };
}

export function BlockEraserCanvas({
  blockId,
  onClose,
}: {
  blockId: string;
  onClose: () => void;
}) {
  const block = useProjectStore((s) =>
    s.project.customBlocks.find((b) => b.id === blockId)
  );
  const apply = useProjectStore((s) => s.applyBlockEntities);

  // 容器尺寸
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(200, r.width), h: Math.max(200, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 工作集
  const [drafted, setDrafted] = useState<DxfEntity[]>(block?.entities ?? []);
  const [history, setHistory] = useState<DxfEntity[][]>([]);

  // 视图
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const initFitDone = useRef(false);
  useEffect(() => {
    if (!block || initFitDone.current) return;
    if (size.w < 100) return;
    setView(fitView(block.bbox, size.w, size.h));
    initFitDone.current = true;
  }, [block, size.w, size.h]);

  // 工具状态
  const [tool, setTool] = useState<Tool>("brush");
  const [brushR, setBrushR] = useState(80); // mm
  const [preset, setPreset] = useState<SlimPreset>("medium");
  const [strict, setStrict] = useState(false); // 严格框选（完全包含）暂未实现切换，留位

  // 交互状态
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<
    | { kind: "rect"; x0: number; y0: number; x1: number; y1: number }
    | { kind: "pan"; lastPx: number; lastPy: number }
    | { kind: "brush" }
    | null
  >(null);

  if (!block) return null;

  /* ============ 坐标转换 ============ */
  const toWorld = (px: number, py: number) => ({
    x: (px - view.tx) / view.s,
    y: -(py - view.ty) / view.s,
  });

  /* ============ 历史 ============ */
  const pushHistory = (snap: DxfEntity[]) => {
    setHistory((h) => [...h.slice(-49), snap]);
  };
  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1]!;
      setDrafted(last);
      return h.slice(0, -1);
    });
  };
  const resetAll = () => {
    if (!confirm("放弃所有擦除，恢复到打开时的状态？")) return;
    pushHistory(drafted);
    setDrafted(block.entities);
  };

  /* ============ 操作 ============ */
  /** 笔刷扫过一次：去除距离 < 半径的实体 */
  const brushAt = (wx: number, wy: number) => {
    setDrafted((prev) => {
      const next: DxfEntity[] = [];
      let removed = 0;
      for (const e of prev) {
        if (pointToEntityDist(e, wx, wy) <= brushR) {
          removed += 1;
          continue;
        }
        next.push(e);
      }
      return removed > 0 ? next : prev;
    });
  };

  /** 提交框选 */
  const finishRect = (rect: BBox, mode: "erase" | "slim") => {
    const r = normRect(rect);
    pushHistory(drafted);
    if (mode === "erase") {
      setDrafted((prev) => prev.filter((e) => !rectIntersectsEntity(e, r)));
      return;
    }
    // 区域瘦身：把命中的实体单独跑一次 slim，其他保持
    const inside: DxfEntity[] = [];
    const outside: DxfEntity[] = [];
    for (const e of drafted) {
      if (rectIntersectsEntity(e, r)) inside.push(e);
      else outside.push(e);
    }
    if (inside.length === 0) return;
    const opts = presetOptions(preset, block.bbox);
    const sr = slimEntities(inside, block.bbox, opts);
    setDrafted([...outside, ...sr.entities]);
  };

  /* ============ 事件 ============ */
  const onWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const factor = e.evt.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newS = Math.max(0.0001, Math.min(50, view.s * factor));
    // 保持指针下世界坐标不变
    const wx = (pointer.x - view.tx) / view.s;
    const wy = -(pointer.y - view.ty) / view.s;
    const tx = pointer.x - wx * newS;
    const ty = pointer.y + wy * newS;
    setView({ s: newS, tx, ty });
  };

  const onPointerDown = (e: any) => {
    const stage = e.target.getStage();
    const p = stage.getPointerPosition();
    if (!p) return;
    const w = toWorld(p.x, p.y);
    if (tool === "pan" || e.evt.button === 1 || e.evt.shiftKey) {
      setDrag({ kind: "pan", lastPx: p.x, lastPy: p.y });
      return;
    }
    if (tool === "brush") {
      pushHistory(drafted);
      brushAt(w.x, w.y);
      setDrag({ kind: "brush" });
      return;
    }
    if (tool === "rectErase" || tool === "rectSlim") {
      setDrag({ kind: "rect", x0: w.x, y0: w.y, x1: w.x, y1: w.y });
    }
  };

  const onPointerMove = (e: any) => {
    const stage = e.target.getStage();
    const p = stage.getPointerPosition();
    if (!p) return;
    const w = toWorld(p.x, p.y);
    setCursor(w);
    if (!drag) return;
    if (drag.kind === "pan") {
      setView((v) => ({ ...v, tx: v.tx + (p.x - drag.lastPx), ty: v.ty + (p.y - drag.lastPy) }));
      setDrag({ kind: "pan", lastPx: p.x, lastPy: p.y });
    } else if (drag.kind === "brush") {
      brushAt(w.x, w.y);
    } else if (drag.kind === "rect") {
      setDrag({ ...drag, x1: w.x, y1: w.y });
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === "rect") {
      const r: BBox = { minX: drag.x0, minY: drag.y0, maxX: drag.x1, maxY: drag.y1 };
      finishRect(r, tool === "rectSlim" ? "slim" : "erase");
    }
    setDrag(null);
  };

  /* ============ 渲染 ============ */
  const removed = (block.entities.length - drafted.length);
  const removedFromOriginal =
    (block.originalEntities?.length ?? block.entities.length) - drafted.length;

  // 笔刷半径（屏幕 px）
  const brushPx = brushR * view.s;

  // 选择矩形（屏幕坐标）
  const rectScreen = useMemo(() => {
    if (drag?.kind !== "rect") return null;
    const x = Math.min(drag.x0, drag.x1) * view.s + view.tx;
    const y = -Math.max(drag.y0, drag.y1) * view.s + view.ty;
    const w = Math.abs(drag.x1 - drag.x0) * view.s;
    const h = Math.abs(drag.y1 - drag.y0) * view.s;
    return { x, y, w, h };
  }, [drag, view]);

  const onCommit = () => {
    apply(blockId, drafted);
    alert(
      `✅ 已提交\n实体：${block.entities.length} → ${drafted.length}（移除 ${removed}）`
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900/95 text-slate-200">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">图块擦除：{block.name}</span>
          <span className="text-[11px] text-slate-400">
            当前 <b className="text-emerald-300">{drafted.length}</b> /{" "}
            原始 {block.originalEntities?.length ?? block.entities.length}
            {removedFromOriginal > 0 && (
              <span className="ml-2 text-emerald-400">
                已减 {removedFromOriginal} (
                {(
                  (removedFromOriginal /
                    Math.max(
                      block.originalEntities?.length ?? block.entities.length,
                      1
                    )) *
                  100
                ).toFixed(0)}
                %)
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={history.length === 0}
            className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700 disabled:opacity-40"
          >
            <Undo2 size={12} /> 撤销 ({history.length})
          </button>
          <button
            onClick={resetAll}
            className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-700"
          >
            <RotateCcw size={12} /> 重置
          </button>
          <button
            onClick={onCommit}
            className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold hover:bg-emerald-500"
          >
            <Save size={12} /> 应用并关闭
          </button>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800/60 px-4 py-1.5 text-xs">
        <ToolBtn label="平移" active={tool === "pan"} onClick={() => setTool("pan")} icon={<Move size={12} />} />
        <ToolBtn label="橡皮擦" active={tool === "brush"} onClick={() => setTool("brush")} icon={<Eraser size={12} />} />
        <ToolBtn label="框选擦除" active={tool === "rectErase"} onClick={() => setTool("rectErase")} icon={<BoxSelect size={12} />} />
        <ToolBtn label="框选瘦身" active={tool === "rectSlim"} onClick={() => setTool("rectSlim")} icon={<Zap size={12} />} />

        <div className="mx-2 h-4 w-px bg-slate-600" />

        {tool === "brush" && (
          <label className="flex items-center gap-2">
            <span className="text-slate-400">笔刷半径</span>
            <input
              type="range"
              min={5}
              max={2000}
              step={5}
              value={brushR}
              onChange={(e) => setBrushR(Number(e.target.value))}
              className="w-40"
            />
            <input
              type="number"
              min={1}
              value={brushR}
              onChange={(e) => setBrushR(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs"
            />
            <span className="text-slate-400">mm</span>
          </label>
        )}
        {tool === "rectSlim" && (
          <label className="flex items-center gap-2">
            <span className="text-slate-400">区域瘦身预设</span>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as SlimPreset)}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-0.5 text-xs"
            >
              <option value="light">轻度</option>
              <option value="medium">中度</option>
              <option value="heavy">重度</option>
              <option value="silhouette">仅轮廓</option>
            </select>
          </label>
        )}

        <div className="ml-auto text-[11px] text-slate-400">
          滚轮缩放 · 中键/Shift+拖动 平移 · {cursor && `(${cursor.x.toFixed(0)}, ${cursor.y.toFixed(0)})`}
        </div>
      </div>

      {/* 画布 */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden bg-slate-950">
        <Stage
          width={size.w}
          height={size.h}
          onWheel={onWheel}
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          style={{
            cursor:
              tool === "pan"
                ? "grab"
                : tool === "brush"
                ? "none"
                : "crosshair",
          }}
        >
          <Layer listening={false}>
            {/* 实体组：用 view 做仿射 + Y 翻转 */}
            <Group x={view.tx} y={view.ty} scaleX={view.s} scaleY={-view.s}>
              {drafted.map((e, i) => (
                <EntityNode key={i} entity={e} color="#94a3b8" scale={view.s} />
              ))}
            </Group>

            {/* 框选 */}
            {rectScreen && (
              <KRect
                x={rectScreen.x}
                y={rectScreen.y}
                width={rectScreen.w}
                height={rectScreen.h}
                stroke={tool === "rectSlim" ? "#f59e0b" : "#f43f5e"}
                strokeWidth={1}
                dash={[4, 4]}
                fill={
                  tool === "rectSlim"
                    ? "rgba(245,158,11,0.10)"
                    : "rgba(244,63,94,0.10)"
                }
              />
            )}

            {/* 笔刷光标 */}
            {tool === "brush" && cursor && (
              <KCircle
                x={cursor.x * view.s + view.tx}
                y={-cursor.y * view.s + view.ty}
                radius={brushPx}
                stroke="#f43f5e"
                strokeWidth={1}
                dash={[3, 3]}
                fill="rgba(244,63,94,0.12)"
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

function ToolBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1 rounded border px-2 py-1 " +
        (active
          ? "border-sky-400 bg-sky-500/20 text-sky-200"
          : "border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-700")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
