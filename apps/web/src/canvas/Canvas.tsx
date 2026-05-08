/**
 * Konva 画布
 *  - 视口：屏幕像素 = mm * scale；默认 scale 0.05（1m=50px）
 *  - 鼠标滚轮缩放，中键/空格拖动平移
 *  - 网格 100mm 细线 / 1000mm 粗线
 *  - 拖入设备：监听原生 dragover/drop（Stage 容器）
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Line, Text, Group, Circle, Transformer } from "react-konva";
import type Konva from "konva";
import { useProjectStore } from "@/store/projectStore";
import { findTemplate } from "@/lib/equipmentLibrary";
import type { CanvasItem, CustomBlock, Waypoint } from "@ilp/schema";
import { DxfBackgroundLayer, EntityNode } from "./DxfBackgroundLayer";
import { MotionPathLayer } from "./MotionPathLayer";

const MIN_SCALE = 0.005;
const MAX_SCALE = 1;

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 100, y: 100, scale: 0.05 });

  const items = useProjectStore((s) => s.project.canvasItems);
  const equipment = useProjectStore((s) => s.project.equipment);
  const dxfBackgrounds = useProjectStore((s) => s.project.dxfBackgrounds);
  const selectedItemId = useProjectStore((s) => s.selectedItemId);
  const selectItem = useProjectStore((s) => s.selectItem);
  const updateCanvasItem = useProjectStore((s) => s.updateCanvasItem);
  const addEquipmentFromTemplate = useProjectStore((s) => s.addEquipmentFromTemplate);
  const customBlocks = useProjectStore((s) => s.project.customBlocks);
  const addCanvasItemFromCustomBlock = useProjectStore((s) => s.addCanvasItemFromCustomBlock);
  const deleteCanvasItem = useProjectStore((s) => s.deleteCanvasItem);
  const snapStep = useProjectStore((s) => s.snapStep);
  const snap = (v: number) => (snapStep > 0 ? Math.round(v / snapStep) * snapStep : v);
  const trRef = useRef<Konva.Transformer>(null);
  const itemNodeRefs = useRef(new Map<string, Konva.Group>());

  /* ========== 动线相关 ========== */
  const motionPaths = useProjectStore((s) => s.project.motionPaths);
  const drawing = useProjectStore((s) => s.drawingMotionPath);
  const startDraw = useProjectStore((s) => s.startDrawMotionPath);
  const finishDraw = useProjectStore((s) => s.finishDrawMotionPath);
  const cancelDraw = useProjectStore((s) => s.cancelDrawMotionPath);
  const appendWaypoint = useProjectStore((s) => s.appendWaypoint);
  const moveWaypoint = useProjectStore((s) => s.moveWaypoint);
  const insertWaypoint = useProjectStore((s) => s.insertWaypoint);
  const removeWaypoint = useProjectStore((s) => s.removeWaypoint);
  const updateMotionPath = useProjectStore((s) => s.updateMotionPath);
  const selectedPathId = useProjectStore((s) => s.selectedPathId);
  const selectPath = useProjectStore((s) => s.selectPath);

  /** 鼠标在世界坐标的当前位置（mm），用于橡皮筋 */
  type HoverState = { x: number; y: number; snappedItemId?: string } | null;
  const [hover, setHover] = useState<HoverState>(null);
  /** 用于 mousemove 节流：rAF 内才提交到 React 状态 */
  const pendingHover = useRef<HoverState>(null);
  const hoverRaf = useRef<number | null>(null);
  const scheduleHover = (next: HoverState) => {
    pendingHover.current = next;
    if (hoverRaf.current != null) return;
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = null;
      setHover(pendingHover.current);
    });
  };
  useEffect(
    () => () => {
      if (hoverRaf.current != null) cancelAnimationFrame(hoverRaf.current);
    },
    []
  );

  /** 绘制模式已点击次数（reset 时清零） */
  const drawClickCount = useRef(0);
  useEffect(() => {
    if (!drawing) {
      drawClickCount.current = 0;
      setHover(null);
    }
  }, [drawing?.activeId]);

  /** 屏幕点 → 世界 mm */
  const toWorld = (px: number, py: number) => ({
    x: (px - view.x) / view.scale,
    y: (py - view.y) / view.scale,
  });

  /**
   * 找当前点对应的吸附目标：
   *  1) 优先：(wx,wy) 在某 item 的 bbox 内 → 选中该 item
   *  2) 否则：屏幕距离 < 30px 的最近 item
   */
  const findSnapItem = (wx: number, wy: number): { id: string; cx: number; cy: number } | null => {
    for (const it of items) {
      if (!it.visible) continue;
      if (wx >= it.x && wx <= it.x + it.w && wy >= it.y && wy <= it.y + it.h) {
        return { id: it.id, cx: it.x + it.w / 2, cy: it.y + it.h / 2 };
      }
    }
    const SNAP_PX = 30;
    let best: { id: string; cx: number; cy: number; d: number } | null = null;
    for (const it of items) {
      if (!it.visible) continue;
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      const dPx = Math.hypot(cx - wx, cy - wy) * view.scale;
      if (dPx <= SNAP_PX && (!best || dPx < best.d)) {
        best = { id: it.id, cx, cy, d: dPx };
      }
    }
    return best ? { id: best.id, cx: best.cx, cy: best.cy } : null;
  };

  // resize observe
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // delete key + esc/enter 配合动线绘制
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditor = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (drawing) {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelDraw();
        } else if (e.key === "Enter") {
          e.preventDefault();
          finishDraw();
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (inEditor) return;
        if (selectedItemId) deleteCanvasItem(selectedItemId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedItemId, deleteCanvasItem, drawing, cancelDraw, finishDraw]);

  // wheel zoom
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const oldScale = view.scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - view.x) / oldScale,
      y: (pointer.y - view.y) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = 1.15;
    let newScale = direction > 0 ? oldScale * factor : oldScale / factor;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    setView({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const onDragMoveStage = (e: Konva.KonvaEventObject<DragEvent>) => {
    if (e.target === e.target.getStage()) {
      setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
    }
  };

  // HTML5 DnD: 设备库 / 自定义图块 → 画布
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const modelId = e.dataTransfer.getData("application/x-ilp-equipment");
    if (modelId) {
      const tpl = findTemplate(modelId);
      if (!tpl) return;
      const mmX = snap((px - view.x) / view.scale - tpl.footprint.w / 2);
      const mmY = snap((py - view.y) / view.scale - tpl.footprint.h / 2);
      addEquipmentFromTemplate(tpl, mmX, mmY);
      return;
    }

    const blockId = e.dataTransfer.getData("application/x-ilp-customblock");
    if (blockId) {
      const block = customBlocks.find((b) => b.id === blockId);
      if (!block) return;
      const mmX = snap((px - view.x) / view.scale - block.footprint.w / 2);
      const mmY = snap((py - view.y) / view.scale - block.footprint.h / 2);
      addCanvasItemFromCustomBlock(block, mmX, mmY);
    }
  };

  // 监听 fit-view 事件（DXF 导入后自动调用）
  useEffect(() => {
    const handler = () => fitToContent(items, dxfBackgrounds, size, setView);
    window.addEventListener("ilp:fit-view", handler);
    return () => window.removeEventListener("ilp:fit-view", handler);
  }, [items, dxfBackgrounds, size]);

  // Transformer 绑定到当前选中节点
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (selectedItemId) {
      const node = itemNodeRefs.current.get(selectedItemId);
      if (node) {
        tr.nodes([node]);
        tr.getLayer()?.batchDraw();
        return;
      }
    }
    tr.nodes([]);
    tr.getLayer()?.batchDraw();
  }, [selectedItemId, items.length]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-white"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={!drawing}
        onWheel={onWheel}
        onDragMove={onDragMoveStage}
        onMouseMove={(e) => {
          if (!drawing) return;
          const stage = e.target.getStage();
          const p = stage?.getPointerPosition();
          if (!p) return;
          const w = toWorld(p.x, p.y);
          const snapHit = findSnapItem(w.x, w.y);
          scheduleHover(
            snapHit
              ? { x: snapHit.cx, y: snapHit.cy, snappedItemId: snapHit.id }
              : { x: snap(w.x), y: snap(w.y) }
          );
        }}
        onMouseDown={(e) => {
          if (drawing) {
            const stage = e.target.getStage();
            const p = stage?.getPointerPosition();
            if (!p) return;
            const w = toWorld(p.x, p.y);
            const snapHit = findSnapItem(w.x, w.y);
            const activeId = drawing.activeId!;
            const n = drawClickCount.current;

            // 起点：必须命中对象（设备/操作者/料箱）
            if (n === 0) {
              if (!snapHit) return; // 静默忽略；提示条已说明
              moveWaypoint(activeId, 0, {
                x: snapHit.cx,
                y: snapHit.cy,
                anchorItemId: snapHit.id,
                anchorOffset: { dx: 0, dy: 0 },
              });
              drawClickCount.current = 1;
              e.cancelBubble = true;
              return;
            }

            // 命中对象 → 终点；与起点是同一对象时静默忽略（除非已经画了拐点）
            if (snapHit) {
              const path = motionPaths.find((m) => m.id === activeId);
              const startId = path?.waypoints[0]?.anchorItemId;
              const onlyStartFilled = (path?.waypoints.length ?? 0) <= 2 && n === 1;
              if (startId && snapHit.id === startId && onlyStartFilled) return;
              const wp: Waypoint = {
                x: snapHit.cx,
                y: snapHit.cy,
                anchorItemId: snapHit.id,
                anchorOffset: { dx: 0, dy: 0 },
              };
              if (n === 1) moveWaypoint(activeId, 1, wp);
              else appendWaypoint(activeId, wp);
              drawClickCount.current = n + 1;
              finishDraw();
              e.cancelBubble = true;
              return;
            }

            // 空白 → 中间拐点（仅当点击在 stage 上）
            if (e.target !== e.target.getStage()) return;
            const wp: Waypoint = { x: snap(w.x), y: snap(w.y) };
            if (n === 1) moveWaypoint(activeId, 1, wp);
            else appendWaypoint(activeId, wp);
            drawClickCount.current = n + 1;
            return;
          }
          if (e.target === e.target.getStage()) {
            selectItem(null);
            selectPath(null);
          }
        }}
        onDblClick={(e) => {
          if (drawing) {
            // 双击结束（有效 waypoint >= 2）
            const id = drawing.activeId;
            const path = id ? motionPaths.find((m) => m.id === id) : null;
            if (path && path.waypoints.length >= 2) finishDraw();
            else cancelDraw();
            e.evt.preventDefault();
          }
        }}
      >
        <GridLayer view={view} stageSize={size} />
        <DxfBackgroundLayer backgrounds={dxfBackgrounds} scale={view.scale} />
        <Layer listening={!drawing}>
          {items.map((it) => (
            <CanvasItemNode
              key={it.id}
              item={it}
              customBlock={
                it.kind === "customBlock"
                  ? customBlocks.find((b) => b.id === it.refId)
                  : undefined
              }
              viewScale={view.scale}
              registerRef={(node) => {
                if (node) itemNodeRefs.current.set(it.id, node);
                else itemNodeRefs.current.delete(it.id);
              }}
              eqColor={
                it.kind === "equipment"
                  ? (equipment.find((e) => e.id === it.refId)?.attributes?.color as string) ??
                    (it.style?.fill as string) ??
                    "#94a3b8"
                  : "#cbd5e1"
              }
              reach={
                it.kind === "equipment"
                  ? equipment.find((e) => e.id === it.refId)?.reach
                  : undefined
              }
              selected={it.id === selectedItemId}
              onSelect={() => selectItem(it.id)}
              onDragEnd={(x, y) => updateCanvasItem(it.id, { x: snap(x), y: snap(y) })}
              onTransformEnd={(x, y, rot) =>
                updateCanvasItem(it.id, { x: snap(x), y: snap(y), rotation: rot })
              }
            />
          ))}
          <Transformer
            ref={trRef}
            rotateEnabled
            resizeEnabled={false}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            anchorSize={10}
            borderStroke="#0ea5e9"
            anchorStroke="#0ea5e9"
            anchorFill="#fff"
          />
        </Layer>
        {/* 绘制模式：高亮所有可吸附对象（静态蓝框 + 动态绿框分层） */}
        {drawing && (
          <Layer listening={false}>
            <SnapTargetsStatic items={items} scale={view.scale} />
            {hover?.snappedItemId &&
              (() => {
                const it = items.find((i) => i.id === hover.snappedItemId);
                if (!it) return null;
                const pad = 30 / view.scale;
                return (
                  <Rect
                    x={it.x - pad}
                    y={it.y - pad}
                    width={it.w + pad * 2}
                    height={it.h + pad * 2}
                    fill="rgba(16,185,129,0.18)"
                    stroke="#10b981"
                    strokeWidth={3 / view.scale}
                    cornerRadius={6 / view.scale}
                  />
                );
              })()}
          </Layer>
        )}
        <MotionPathLayer
          paths={motionPaths}
          items={items}
          scale={view.scale}
          selectedPathId={selectedPathId}
          drawingPathId={drawing?.activeId ?? null}
          rubberEnd={drawing && drawClickCount.current >= 1 ? hover : null}
          onSelectPath={(id) => {
            selectItem(null);
            selectPath(id);
          }}
          onMoveWaypoint={(pid, idx, wp) => moveWaypoint(pid, idx, wp)}
          onInsertWaypointBetween={(pid, idx, wp) => insertWaypoint(pid, idx, wp)}
          onRemoveWaypoint={(pid, idx) => removeWaypoint(pid, idx)}
        />
      </Stage>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-900/70 px-2 py-1 text-xs text-white">
        {(view.scale * 1000).toFixed(1)} px/m · 拖入设备库 / 滚轮缩放 / 拖拽平移 / Del 删除
      </div>

      {/* 绘制动线提示条 */}
      {drawing && (() => {
        const activePath = motionPaths.find((m) => m.id === drawing.activeId);
        const startPicked = !!activePath?.waypoints[0]?.anchorItemId;
        return <DrawingHint startPicked={startPicked} onCancel={cancelDraw} />;
      })()}
      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          className="rounded bg-white/90 px-2 py-1 text-xs text-slate-700 shadow ring-1 ring-slate-200 hover:bg-white"
          onClick={() => fitToContent(items, dxfBackgrounds, size, setView)}
        >
          适配视图
        </button>
        <button
          className="rounded bg-white/90 px-2 py-1 text-xs text-slate-700 shadow ring-1 ring-slate-200 hover:bg-white"
          onClick={() => setView({ x: size.w / 2, y: size.h / 2, scale: 0.05 })}
        >
          重置
        </button>
      </div>
    </div>
  );
}

function fitToContent(
  items: CanvasItem[],
  bgs: { bbox?: { minX: number; minY: number; maxX: number; maxY: number } }[],
  stageSize: { w: number; h: number },
  setView: (v: { x: number; y: number; scale: number }) => void
) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const expand = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  };
  for (const it of items) expand(it.x, it.y, it.x + it.w, it.y + it.h);
  for (const b of bgs) {
    if (b.bbox) expand(b.bbox.minX, b.bbox.minY, b.bbox.maxX, b.bbox.maxY);
  }
  if (!Number.isFinite(minX)) return;
  const pad = 0.1;
  const w = (maxX - minX) * (1 + pad * 2);
  const h = (maxY - minY) * (1 + pad * 2);
  if (w <= 0 || h <= 0) return;
  const scale = Math.min(stageSize.w / w, stageSize.h / h);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  setView({
    scale,
    x: stageSize.w / 2 - cx * scale,
    y: stageSize.h / 2 - cy * scale,
  });
}

interface CanvasItemNodeProps {
  item: CanvasItem;
  customBlock?: CustomBlock;
  viewScale: number;
  eqColor: string;
  reach?: number;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onTransformEnd: (x: number, y: number, rotation: number) => void;
  registerRef: (node: Konva.Group | null) => void;
}
const CanvasItemNode = memo(
  CanvasItemNodeImpl,
  // 自定义浅比较：忽略回调 ref 变化（回调内部都基于 store API + item.id，逻辑稳定）
  (prev, next) =>
    prev.item === next.item &&
    prev.customBlock === next.customBlock &&
    prev.viewScale === next.viewScale &&
    prev.eqColor === next.eqColor &&
    prev.reach === next.reach &&
    prev.selected === next.selected
);
function CanvasItemNodeImpl(props: CanvasItemNodeProps) {
  const {
    item,
    customBlock,
    viewScale,
    eqColor,
    reach,
    selected,
    onSelect,
    onDragEnd,
    onTransformEnd,
    registerRef,
  } = props;

  const isCustomBlock = item.kind === "customBlock" && customBlock;

  return (
    <Group
      ref={(node) => registerRef(node)}
      x={item.x}
      y={item.y}
      rotation={item.rotation}
      draggable={!item.locked}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
      onTransformEnd={(e) => {
        const node = e.target;
        onTransformEnd(node.x(), node.y(), node.rotation());
      }}
    >
      {reach && reach > 0 && (
        <Circle
          x={item.w / 2}
          y={item.h / 2}
          radius={reach}
          stroke={eqColor}
          opacity={0.25}
          dash={[200, 100]}
          strokeWidth={20}
          listening={false}
        />
      )}
      {isCustomBlock ? (
        // 自定义图块：渲染原始 DXF 几何，平移到包围盒原点
        <>
          <Rect
            width={item.w}
            height={item.h}
            fill="transparent"
            stroke={selected ? "#0ea5e9" : "#94a3b8"}
            strokeWidth={selected ? 60 : 10}
            dash={selected ? undefined : [60, 40]}
          />
          <Group x={-customBlock!.bbox.minX} y={-customBlock!.bbox.minY}>
            {customBlock!.entities.map((e, i) => (
              <EntityNode key={i} entity={e} color={customBlock!.color} scale={viewScale} />
            ))}
          </Group>
        </>
      ) : (
        <Rect
          width={item.w}
          height={item.h}
          fill={eqColor}
          opacity={0.7}
          stroke={selected ? "#0ea5e9" : "#334155"}
          strokeWidth={selected ? 60 : 20}
        />
      )}
      <Text
        text={item.label ?? ""}
        x={0}
        y={item.h + 30}
        fontSize={Math.max(120, item.w / 12)}
        fill="#0f172a"
        width={item.w}
        align="center"
      />
    </Group>
  );
}

/** 可吸附目标的静态蓝色提示框；items/scale 不变时不重渲 */
const SnapTargetsStatic = memo(function SnapTargetsStatic({
  items,
  scale,
}: {
  items: CanvasItem[];
  scale: number;
}) {
  const pad = 30 / scale;
  const dash = [10 / scale, 8 / scale];
  const sw = 1.5 / scale;
  const cr = 6 / scale;
  return (
    <>
      {items
        .filter((it) => it.visible)
        .map((it) => (
          <Rect
            key={it.id}
            x={it.x - pad}
            y={it.y - pad}
            width={it.w + pad * 2}
            height={it.h + pad * 2}
            fill="rgba(14,165,233,0.06)"
            stroke="#0ea5e9"
            strokeWidth={sw}
            dash={dash}
            cornerRadius={cr}
          />
        ))}
    </>
  );
});

/** 绘制动线的提示条；文案随阶段切换 */
function DrawingHint({
  startPicked,
  onCancel,
}: {
  startPicked: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-md bg-sky-600 px-3 py-1.5 text-xs text-white shadow-lg">
      {!startPicked ? (
        <>
          <b>选择起点对象</b>：点击设备 / 操作者 / 料箱（蓝框为可选目标，hover 时变绿）
        </>
      ) : (
        <>
          <b>选择终点对象</b>，或在空白处点击添加拐点 ·{" "}
          <kbd className="rounded bg-white/20 px-1">Esc</kbd> 取消
        </>
      )}
      <button
        onClick={onCancel}
        className="ml-3 rounded bg-rose-500 px-2 py-0.5 hover:bg-rose-400"
      >
        取消
      </button>
    </div>
  );
}

function GridLayer({ view, stageSize }: { view: { x: number; y: number; scale: number }; stageSize: { w: number; h: number } }) {
  // 计算视口对应的 mm 范围
  const { x, y, scale } = view;
  const xMin = -x / scale;
  const yMin = -y / scale;
  const xMax = (stageSize.w - x) / scale;
  const yMax = (stageSize.h - y) / scale;

  const STEP = 1000; // 1m 粗线
  const lines = useMemo(() => {
    const arr: { points: number[]; bold: boolean }[] = [];
    const startX = Math.floor(xMin / STEP) * STEP;
    const startY = Math.floor(yMin / STEP) * STEP;
    for (let gx = startX; gx <= xMax; gx += STEP) {
      arr.push({ points: [gx, yMin, gx, yMax], bold: gx % (STEP * 5) === 0 });
    }
    for (let gy = startY; gy <= yMax; gy += STEP) {
      arr.push({ points: [xMin, gy, xMax, gy], bold: gy % (STEP * 5) === 0 });
    }
    return arr;
  }, [xMin, yMin, xMax, yMax]);

  return (
    <Layer listening={false}>
      {lines.map((l, i) => (
        <Line
          key={i}
          points={l.points}
          stroke={l.bold ? "#cbd5e1" : "#e2e8f0"}
          strokeWidth={(l.bold ? 2 : 1) / scale}
        />
      ))}
      {/* 原点十字 */}
      <Line points={[-500, 0, 500, 0]} stroke="#ef4444" strokeWidth={3 / scale} />
      <Line points={[0, -500, 0, 500]} stroke="#10b981" strokeWidth={3 / scale} />
    </Layer>
  );
}
