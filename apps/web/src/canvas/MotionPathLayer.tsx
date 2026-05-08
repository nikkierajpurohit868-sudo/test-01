/**
 * 动线渲染层
 *  - 每条 MotionPath 渲染为虚线折线 + 终点箭头 + 中段长度/工时标签
 *  - 端点：吸附则显示链锁圆点，否则普通圆点
 *  - 选中：waypoint 出现可拖拽手柄
 *  - 绘制中：最后一段为橡皮筋（跟随鼠标）
 */
import { memo } from "react";
import { Layer, Group, Line, Circle, Arrow, Text, Rect } from "react-konva";
import type Konva from "konva";
import type { CanvasItem, MotionPath, Waypoint } from "@ilp/schema";
import { resolveWaypoint } from "@/lib/motionTime";

export interface MotionPathLayerProps {
  paths: MotionPath[];
  items: CanvasItem[];
  scale: number;
  selectedPathId: string | null;
  drawingPathId: string | null;
  /** 绘制模式时跟随鼠标的"橡皮筋"端点（mm 坐标），null=未在悬停 */
  rubberEnd: { x: number; y: number; snappedItemId?: string } | null;
  onSelectPath: (id: string | null) => void;
  onMoveWaypoint: (pathId: string, idx: number, wp: Partial<Waypoint>) => void;
  onInsertWaypointBetween: (pathId: string, idx: number, wp: Waypoint) => void;
  onRemoveWaypoint: (pathId: string, idx: number) => void;
}

export function MotionPathLayer({
  paths,
  items,
  scale,
  selectedPathId,
  drawingPathId,
  rubberEnd,
  onSelectPath,
  onMoveWaypoint,
  onInsertWaypointBetween,
  onRemoveWaypoint,
}: MotionPathLayerProps) {
  return (
    <Layer>
      {paths
        .filter((p) => p.visible)
        .map((p) => (
          <PathNode
            key={p.id}
            path={p}
            items={items}
            scale={scale}
            selected={p.id === selectedPathId}
            drawing={p.id === drawingPathId}
            rubberEnd={p.id === drawingPathId ? rubberEnd : null}
            onSelect={() => onSelectPath(p.id)}
            onMoveWaypoint={(idx, wp) => onMoveWaypoint(p.id, idx, wp)}
            onInsertWaypointBetween={(idx, wp) => onInsertWaypointBetween(p.id, idx, wp)}
            onRemoveWaypoint={(idx) => onRemoveWaypoint(p.id, idx)}
          />
        ))}
    </Layer>
  );
}

interface PathNodeProps {
  path: MotionPath;
  items: CanvasItem[];
  scale: number;
  selected: boolean;
  drawing: boolean;
  rubberEnd: { x: number; y: number; snappedItemId?: string } | null;
  onSelect: () => void;
  onMoveWaypoint: (idx: number, wp: Partial<Waypoint>) => void;
  onInsertWaypointBetween: (idx: number, wp: Waypoint) => void;
  onRemoveWaypoint: (idx: number) => void;
}
const PathNode = memo(
  PathNodeImpl,
  // 非绘制中的 path：rubberEnd 变化（hover 移动）不应触发重渲
  (prev, next) => {
    if (
      prev.path !== next.path ||
      prev.items !== next.items ||
      prev.scale !== next.scale ||
      prev.selected !== next.selected ||
      prev.drawing !== next.drawing
    )
      return false;
    // 仅绘制中需要 rubberEnd 比较
    if (next.drawing && prev.rubberEnd !== next.rubberEnd) return false;
    return true;
  }
);
function PathNodeImpl({
  path,
  items,
  scale,
  selected,
  drawing,
  rubberEnd,
  onSelect,
  onMoveWaypoint,
  onInsertWaypointBetween,
  onRemoveWaypoint,
}: PathNodeProps) {
  // 解析所有 waypoints 到绝对世界坐标
  const resolved = path.waypoints.map((w) => resolveWaypoint(w, items));

  // 绘制中追加橡皮筋点
  const display = drawing && rubberEnd
    ? [...resolved, { x: rubberEnd.x, y: rubberEnd.y }]
    : resolved;

  if (display.length < 2) return null;

  const flatPoints: number[] = [];
  for (const p of display) flatPoints.push(p.x, p.y);

  // 屏幕 1px 转 mm 的比例（用于画线宽度）
  const px = 1 / scale;
  const stroke = path.color;

  // 主体折线（虚线）
  const dashShort = 60 * px;
  const dashGap = 40 * px;

  // 中点（用于显示长度/工时标签）
  const midIdx = Math.floor(display.length / 2);
  const midA = display[midIdx - 1] ?? display[0]!;
  const midB = display[midIdx] ?? display[display.length - 1]!;
  const labelX = (midA.x + midB.x) / 2;
  const labelY = (midA.y + midB.y) / 2;

  const der = path.derived;
  const lengthM = der ? der.lengthMm / 1000 : 0;
  const totalSec = der ? der.totalSec : 0;

  // 箭头：最后一段
  const last = display[display.length - 1]!;
  const beforeLast = display[display.length - 2]!;

  return (
    <Group onMouseDown={(e) => { e.cancelBubble = true; onSelect(); }}>
      {/* 透明粗线作为 hit area，便于点击 */}
      <Line
        points={flatPoints}
        stroke="rgba(0,0,0,0)"
        strokeWidth={20 * px}
        listening={!drawing}
      />
      <Line
        points={flatPoints}
        stroke={stroke}
        strokeWidth={(selected ? 4 : 3) * px}
        dash={drawing ? [dashShort * 0.5, dashGap * 0.5] : [dashShort, dashGap]}
        opacity={drawing ? 0.7 : 1}
        listening={false}
      />
      {/* 终端箭头 */}
      <Arrow
        points={[beforeLast.x, beforeLast.y, last.x, last.y]}
        pointerLength={20 * px}
        pointerWidth={20 * px}
        fill={stroke}
        stroke={stroke}
        strokeWidth={(selected ? 4 : 3) * px}
        listening={false}
      />

      {/* 端点圆 */}
      {resolved.map((pt, i) => {
        const wp = path.waypoints[i]!;
        const isAnchored = !!wp.anchorItemId;
        const isEndpoint = i === 0 || i === resolved.length - 1;
        const r = (isEndpoint ? 8 : 5) * px;
        return (
          <Group key={i}>
            <Circle
              x={pt.x}
              y={pt.y}
              radius={r}
              fill={isAnchored ? "#fff" : stroke}
              stroke={stroke}
              strokeWidth={2 * px}
              draggable={selected && !path.locked}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                onSelect();
              }}
              onDblClick={() => {
                // 双击删除中间 waypoint（端点保留）
                if (i !== 0 && i !== resolved.length - 1) {
                  onRemoveWaypoint(i);
                }
              }}
              onDragMove={(e) => {
                const node = e.target as Konva.Circle;
                onMoveWaypoint(i, { x: node.x(), y: node.y(), anchorItemId: undefined, anchorOffset: undefined });
              }}
            />
            {/* 锚点链锁标记 */}
            {isAnchored && (
              <Circle
                x={pt.x}
                y={pt.y}
                radius={r * 0.4}
                fill={stroke}
                listening={false}
              />
            )}
          </Group>
        );
      })}

      {/* 中段插入手柄（仅选中时） */}
      {selected && !drawing &&
        resolved.slice(0, -1).map((a, i) => {
          const b = resolved[i + 1]!;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <Circle
              key={`mid-${i}`}
              x={mx}
              y={my}
              radius={4 * px}
              fill="#fff"
              stroke={stroke}
              strokeWidth={1.5 * px}
              opacity={0.8}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                onInsertWaypointBetween(i + 1, { x: mx, y: my });
              }}
            />
          );
        })}

      {/* 长度/工时标签 */}
      {der && !drawing && (
        <Group x={labelX} y={labelY}>
          <Rect
            x={-160 * px}
            y={-22 * px}
            width={320 * px}
            height={44 * px}
            fill="#0f172a"
            opacity={0.85}
            cornerRadius={6 * px}
            listening={false}
          />
          <Text
            x={-160 * px}
            y={-18 * px}
            width={320 * px}
            text={`${lengthM.toFixed(2)} m  ·  ${totalSec.toFixed(1)} s`}
            fontSize={14 * px}
            fill="#fff"
            align="center"
            listening={false}
          />
          <Text
            x={-160 * px}
            y={-2 * px}
            width={320 * px}
            text={path.name}
            fontSize={11 * px}
            fill="#cbd5e1"
            align="center"
            listening={false}
          />
        </Group>
      )}

      {/* 绘制中橡皮筋端点提示 */}
      {drawing && rubberEnd && (
        <Circle
          x={rubberEnd.x}
          y={rubberEnd.y}
          radius={8 * px}
          fill={rubberEnd.snappedItemId ? "#10b981" : "#fff"}
          stroke={stroke}
          strokeWidth={2 * px}
          listening={false}
        />
      )}
    </Group>
  );
}
