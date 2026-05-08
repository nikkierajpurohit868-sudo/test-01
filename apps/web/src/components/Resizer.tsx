/**
 * 拖拽调整面板尺寸
 *  - direction "vertical": 拖动垂直分割条改宽度
 *  - direction "horizontal": 拖动水平分割条改高度
 *  - 双击重置为默认
 *  - 尺寸自动持久化到 localStorage
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type ResizeDirection = "left" | "right" | "top";

export function useResizable(
  storageKey: string,
  defaultSize: number,
  min: number,
  max: number
): [number, (n: number) => void, () => void] {
  const [size, setSize] = useState<number>(() => {
    if (typeof window === "undefined") return defaultSize;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultSize;
    const n = Number(raw);
    if (!Number.isFinite(n)) return defaultSize;
    return Math.min(max, Math.max(min, n));
  });

  const setClamped = useCallback(
    (n: number) => {
      const v = Math.min(max, Math.max(min, n));
      setSize(v);
      try {
        window.localStorage.setItem(storageKey, String(v));
      } catch {
        // ignore quota errors
      }
    },
    [storageKey, min, max]
  );

  const reset = useCallback(() => {
    setSize(defaultSize);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey, defaultSize]);

  return [size, setClamped, reset];
}

/**
 * 拖拽手柄
 *  - vertical 用于左右面板（拖动改 width）
 *  - horizontal 用于上下面板（拖动改 height）
 */
export function Resizer({
  direction,
  onResize,
  onReset,
}: {
  direction: "vertical" | "horizontal";
  /** 鼠标移动 delta（向右/向下为正） */
  onResize: (deltaPx: number) => void;
  onReset?: () => void;
}) {
  const [active, setActive] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const onMove = (e: MouseEvent) => {
      if (!startRef.current) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      onResize(direction === "vertical" ? dx : dy);
      startRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => {
      setActive(false);
      startRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = direction === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [active, direction, onResize]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, y: e.clientY };
    setActive(true);
  };

  const isVert = direction === "vertical";
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      title={onReset ? "拖动调整 / 双击重置" : "拖动调整"}
      className={
        (isVert
          ? "h-full w-1 cursor-col-resize hover:w-1.5"
          : "h-1 w-full cursor-row-resize hover:h-1.5") +
        " shrink-0 transition-all " +
        (active ? "bg-sky-400" : "bg-slate-200 hover:bg-sky-300")
      }
    />
  );
}
