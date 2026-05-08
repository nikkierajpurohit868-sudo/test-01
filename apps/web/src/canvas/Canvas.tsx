/**
 * Konva 画布
 *  - 视口：屏幕像素 = mm * scale；默认 scale 0.05（1m=50px）
 *  - 鼠标滚轮缩放，中键/空格拖动平移
 *  - 网格 100mm 细线 / 1000mm 粗线
 *  - 拖入设备：监听原生 dragover/drop（Stage 容器）
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Rect, Line, Text, Group, Circle, Transformer } from "react-konva";
import type Konva from "konva";
import { useProjectStore } from "@/store/projectStore";
import { findTemplate } from "@/lib/equipmentLibrary";
import type { CanvasItem, CustomBlock } from "@ilp/schema";
import { DxfBackgroundLayer, EntityNode } from "./DxfBackgroundLayer";

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

  // delete key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedItemId) {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
        deleteCanvasItem(selectedItemId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedItemId, deleteCanvasItem]);

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
        draggable
        onWheel={onWheel}
        onDragMove={onDragMoveStage}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) selectItem(null);
        }}
      >
        <GridLayer view={view} stageSize={size} />
        <DxfBackgroundLayer backgrounds={dxfBackgrounds} scale={view.scale} />
        <Layer>
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
      </Stage>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-900/70 px-2 py-1 text-xs text-white">
        {(view.scale * 1000).toFixed(1)} px/m · 拖入设备库 / 滚轮缩放 / 拖拽平移 / Del 删除
      </div>
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

function CanvasItemNode(props: {
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
}) {
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
