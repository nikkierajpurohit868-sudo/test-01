/**
 * 把一组 DxfEntity 渲染到 offscreen 2D canvas，输出 PNG data URL。
 * 用于图块预览缩略图。
 */
import type { DxfEntity } from "@ilp/schema";

export function renderBlockPreview(
  entities: DxfEntity[],
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  size = 128,
  padding = 6,
  strokeColor = "#334155",
  bgColor = "#ffffff"
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  if (w <= 0 || h <= 0 || !Number.isFinite(w) || !Number.isFinite(h)) {
    return canvas.toDataURL("image/png");
  }

  // 等比缩放到内框
  const inner = size - padding * 2;
  const scale = Math.min(inner / w, inner / h);
  const offX = padding + (inner - w * scale) / 2 - bbox.minX * scale;
  const offY = padding + (inner - h * scale) / 2 - bbox.minY * scale;

  // DXF Y 朝上，canvas Y 朝下：翻转 Y
  const tx = (x: number) => offX + x * scale;
  const ty = (y: number) => size - (offY + y * scale);

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = strokeColor;

  for (const e of entities) {
    switch (e.kind) {
      case "line": {
        const [x1, y1, x2, y2] = e.points;
        if (
          x1 === undefined ||
          y1 === undefined ||
          x2 === undefined ||
          y2 === undefined
        )
          break;
        ctx.beginPath();
        ctx.moveTo(tx(x1), ty(y1));
        ctx.lineTo(tx(x2), ty(y2));
        ctx.stroke();
        break;
      }
      case "polyline": {
        if (e.points.length < 4) break;
        ctx.beginPath();
        ctx.moveTo(tx(e.points[0]!), ty(e.points[1]!));
        for (let i = 2; i < e.points.length; i += 2) {
          ctx.lineTo(tx(e.points[i]!), ty(e.points[i + 1]!));
        }
        if (e.closed) ctx.closePath();
        ctx.stroke();
        break;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(tx(e.cx), ty(e.cy), Math.max(0.5, e.r * scale), 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "arc": {
        ctx.beginPath();
        ctx.arc(
          tx(e.cx),
          ty(e.cy),
          Math.max(0.5, e.r * scale),
          // canvas Y 翻转，弧角也要翻转
          -e.endAngle,
          -e.startAngle
        );
        ctx.stroke();
        break;
      }
      case "text": {
        // 缩略图里文字噪声大，画一个小标记代替
        ctx.beginPath();
        ctx.arc(tx(e.x), ty(e.y), 1.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  return canvas.toDataURL("image/png");
}
