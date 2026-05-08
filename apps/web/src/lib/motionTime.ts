/**
 * 动线工时计算
 *  - pathLengthMm: 累加 waypoint 段长
 *  - resolveWaypoint: 若有 anchorItemId 则返回 anchor.x + offset.dx
 *  - computeMotionTime: 根据 standardMode 分支输出 derived
 */
import type {
  MotionPath,
  MotionDerived,
  MotionDefaults,
  Waypoint,
  CanvasItem,
} from "@ilp/schema";
import {
  SECONDS_PER_TMU,
  SPEED_BY_TYPE,
  TMU_PER_STEP_BY_TYPE,
  ACTION_TMU,
  MOTION_TYPE_LABEL,
} from "./motionStandards";

/** 把锚点解析为绝对世界坐标 */
export function resolveWaypoint(wp: Waypoint, items: CanvasItem[]): { x: number; y: number } {
  if (!wp.anchorItemId) return { x: wp.x, y: wp.y };
  const it = items.find((i) => i.id === wp.anchorItemId);
  if (!it) return { x: wp.x, y: wp.y };
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const off = wp.anchorOffset ?? { dx: 0, dy: 0 };
  // 注意：暂不考虑 item.rotation 对 offset 的旋转，保持简单
  return { x: cx + off.dx, y: cy + off.dy };
}

/** 计算路径累计长度 (mm) */
export function pathLengthMm(waypoints: Waypoint[], items: CanvasItem[]): number {
  if (waypoints.length < 2) return 0;
  let total = 0;
  let prev = resolveWaypoint(waypoints[0]!, items);
  for (let i = 1; i < waypoints.length; i++) {
    const cur = resolveWaypoint(waypoints[i]!, items);
    total += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    prev = cur;
  }
  return total;
}

export interface ComputeOpts {
  defaults: MotionDefaults;
  items: CanvasItem[];
}

/** 主入口：根据 standardMode 计算并返回 derived 字段 */
export function computeMotionTime(path: MotionPath, opts: ComputeOpts): MotionDerived {
  const lengthMm = pathLengthMm(path.waypoints, opts.items);
  const lengthM = lengthMm / 1000;
  const allowance = path.customAllowance ?? opts.defaults.pfdAllowance;
  const breakdown: NonNullable<MotionDerived["breakdown"]> = [];

  // 端点动作 TMU 汇总
  let actionsTmu = 0;
  for (const a of path.endpointActions) {
    const def = ACTION_TMU[a.actionId];
    if (!def) continue;
    actionsTmu += def.tmu;
    breakdown.push({
      label: `${def.label} (${a.at === "start" ? "起点" : a.at === "end" ? "终点" : `第${a.at}点`})`,
      sec: def.tmu * SECONDS_PER_TMU * (1 + allowance),
      tmu: def.tmu,
    });
  }
  const actionsSec = actionsTmu * SECONDS_PER_TMU * (1 + allowance);

  let walkSec = 0;
  let tmu: number | undefined;
  let steps: number | undefined;

  if (path.standardMode === "uas") {
    const speed = SPEED_BY_TYPE[path.motionType] ?? 1.0;
    walkSec = (lengthM / Math.max(speed, 0.01)) * (1 + allowance);
    breakdown.unshift({
      label: `行走 ${MOTION_TYPE_LABEL[path.motionType]} @${speed.toFixed(2)} m/s`,
      sec: walkSec,
    });
  } else if (path.standardMode === "mtm1") {
    const stepLen = opts.defaults.stepLengthMm;
    steps = Math.max(0, Math.round(lengthMm / Math.max(stepLen, 1)));
    const tmuPerStep = TMU_PER_STEP_BY_TYPE[path.motionType] ?? 15;
    const walkTmu = steps * tmuPerStep;
    tmu = walkTmu + actionsTmu;
    walkSec = walkTmu * SECONDS_PER_TMU * (1 + allowance);
    breakdown.unshift({
      label: `行走 ${steps} 步 × ${tmuPerStep} TMU (步长 ${stepLen}mm)`,
      sec: walkSec,
      tmu: walkTmu,
    });
  } else {
    // custom
    const speed = path.customSpeed ?? 1.0;
    walkSec = (lengthM / Math.max(speed, 0.01)) * (1 + allowance);
    breakdown.unshift({
      label: `行走 自定义 @${speed.toFixed(2)} m/s`,
      sec: walkSec,
    });
  }

  const totalSec = walkSec + actionsSec;
  return {
    lengthMm,
    walkSec,
    actionsSec,
    totalSec,
    tmu,
    steps,
    breakdown,
  };
}
