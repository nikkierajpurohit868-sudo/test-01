/**
 * DXF 底图渲染：在 Konva 中作为只读 Layer
 *  - 每个 background 一个 Group，可整体 origin/rotation/opacity
 *  - listening=false，避免事件命中
 */
import { Layer, Group, Line, Circle, Arc, Text } from "react-konva";
import type { DxfBackground, DxfEntity } from "@ilp/schema";

export function DxfBackgroundLayer({
  backgrounds,
  scale,
}: {
  backgrounds: DxfBackground[];
  scale: number;
}) {
  return (
    <Layer listening={false}>
      {backgrounds
        .filter((b) => b.visible)
        .map((b) => (
          <Group key={b.id} x={b.origin.x} y={b.origin.y} rotation={b.rotation} opacity={b.opacity}>
            {b.entities.map((e, i) => (
              <EntityNode key={i} entity={e} color={b.color} scale={scale} />
            ))}
          </Group>
        ))}
    </Layer>
  );
}

export function EntityNode({ entity, color, scale }: { entity: DxfEntity; color: string; scale: number }) {
  const stroke = 1 / scale; // 屏幕 1px
  switch (entity.kind) {
    case "line":
      return <Line points={entity.points} stroke={color} strokeWidth={stroke} />;
    case "polyline":
      return (
        <Line
          points={entity.points}
          stroke={color}
          strokeWidth={stroke}
          closed={entity.closed}
        />
      );
    case "circle":
      return (
        <Circle x={entity.cx} y={entity.cy} radius={entity.r} stroke={color} strokeWidth={stroke} />
      );
    case "arc":
      // Konva Arc 用 angle (度) + rotation
      return (
        <Arc
          x={entity.cx}
          y={entity.cy}
          innerRadius={entity.r}
          outerRadius={entity.r}
          angle={((entity.endAngle - entity.startAngle) * 180) / Math.PI}
          rotation={(entity.startAngle * 180) / Math.PI}
          stroke={color}
          strokeWidth={stroke}
        />
      );
    case "text":
      return (
        <Text
          x={entity.x}
          y={entity.y}
          text={entity.text}
          fontSize={entity.height}
          rotation={entity.rotation}
          // DXF 文本基线在左下，Konva 在左上：上移一个文本高度
          offsetY={entity.height}
          fill={color}
        />
      );
  }
}
