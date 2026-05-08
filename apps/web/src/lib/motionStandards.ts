/**
 * 操作动线 / 标准工时常量表
 *  参考：
 *   - MTM-1 数据卡 (1 TMU = 0.036 s, 走路 ~25 TMU/m, 步长 ~750mm)
 *   - MTM-UAS 简化表
 *   - REFA / 工厂典型经验值
 */
import type { MotionType, MotionActionId } from "@ilp/schema";

/** 1 TMU = 0.036 秒 */
export const SECONDS_PER_TMU = 0.036;

/** 速度档（m/s） */
export const SPEED_BY_TYPE: Record<MotionType, number> = {
  walk_unloaded: 1.4,
  walk_uas_standard: 1.1,
  walk_light: 1.0,
  walk_medium: 0.85,
  walk_heavy: 0.7,
  cart: 1.2,
  custom: 1.0, // 占位，custom 用 path.customSpeed
};

/** 类型中文标签 */
export const MOTION_TYPE_LABEL: Record<MotionType, string> = {
  walk_unloaded: "自由步行（空载）",
  walk_uas_standard: "UAS 标准",
  walk_light: "轻载（< 5kg）",
  walk_medium: "中载（5–15kg）",
  walk_heavy: "重载（> 23kg）",
  cart: "推手推车",
  custom: "自定义",
};

/** 类型颜色（建议） */
export const MOTION_TYPE_COLOR: Record<MotionType, string> = {
  walk_unloaded: "#10b981",
  walk_uas_standard: "#0ea5e9",
  walk_light: "#06b6d4",
  walk_medium: "#f59e0b",
  walk_heavy: "#dc2626",
  cart: "#8b5cf6",
  custom: "#64748b",
};

/** MTM-1 单步 TMU（按类型）— 步长默认 750mm */
export const TMU_PER_STEP_BY_TYPE: Record<MotionType, number> = {
  walk_unloaded: 12, // 略快于 W-P
  walk_uas_standard: 15, // MTM-1 W-P
  walk_light: 16,
  walk_medium: 17, // MTM-1 W-PO
  walk_heavy: 19,
  cart: 14,
  custom: 15,
};

/** 端点/中段动作的 TMU 标定 + 标签 */
export const ACTION_TMU: Record<MotionActionId, { tmu: number; label: string }> = {
  pickup_small: { tmu: 13, label: "拾起小件" },
  place_small: { tmu: 13, label: "放置小件" },
  turn_90: { tmu: 18.6, label: "转身 90°" },
  stoop_pickup: { tmu: 29.0, label: "弯腰拾起" },
  cart_start: { tmu: 5.6, label: "推车启动" },
};

/** 默认显示的动作选项顺序 */
export const ACTION_ORDER: MotionActionId[] = [
  "pickup_small",
  "place_small",
  "turn_90",
  "stoop_pickup",
  "cart_start",
];
