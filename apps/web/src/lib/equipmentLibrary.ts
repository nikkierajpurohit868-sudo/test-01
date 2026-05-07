/**
 * 内置设备库（M1 硬编码；M2 移到 packages/equipment-lib JSON）
 * 单位：mm；unitCost：万元
 */
import type { EquipmentCategory } from "@ilp/schema";

export interface EquipmentTemplate {
  modelId: string;
  name: string;
  category: EquipmentCategory;
  footprint: { w: number; h: number };
  reach?: number;
  unitCost: number;
  color: string;
  desc?: string;
}

export const EQUIPMENT_LIBRARY: EquipmentTemplate[] = [
  {
    modelId: "robot.kuka.kr210",
    name: "KUKA KR210 R2700",
    category: "robot",
    footprint: { w: 1000, h: 1000 },
    reach: 2700,
    unitCost: 35,
    color: "#f97316",
    desc: "通用 6 轴搬运/点焊机器人",
  },
  {
    modelId: "robot.fanuc.r2000ic",
    name: "FANUC R-2000iC/210F",
    category: "robot",
    footprint: { w: 950, h: 950 },
    reach: 2655,
    unitCost: 33,
    color: "#eab308",
  },
  {
    modelId: "weldgun.spot.cx",
    name: "C 型点焊枪",
    category: "weld_gun",
    footprint: { w: 600, h: 400 },
    unitCost: 8,
    color: "#dc2626",
  },
  {
    modelId: "sprgun.tox",
    name: "TOX SPR 自冲铆枪",
    category: "spr_gun",
    footprint: { w: 700, h: 500 },
    unitCost: 15,
    color: "#a855f7",
  },
  {
    modelId: "fixture.geo",
    name: "GEO 主拼夹具",
    category: "fixture",
    footprint: { w: 4000, h: 2500 },
    unitCost: 80,
    color: "#10b981",
  },
  {
    modelId: "conveyor.skid",
    name: "滑橇输送线（4m 段）",
    category: "conveyor",
    footprint: { w: 4000, h: 1200 },
    unitCost: 12,
    color: "#64748b",
  },
  {
    modelId: "agv.heavy",
    name: "重载 AGV",
    category: "agv",
    footprint: { w: 1800, h: 1200 },
    unitCost: 25,
    color: "#0ea5e9",
  },
  {
    modelId: "rack.part",
    name: "零件料架",
    category: "rack",
    footprint: { w: 1500, h: 1000 },
    unitCost: 1,
    color: "#94a3b8",
  },
  {
    modelId: "cell.work",
    name: "工位围栏（5×5m）",
    category: "cell",
    footprint: { w: 5000, h: 5000 },
    unitCost: 3,
    color: "#cbd5e1",
  },
  {
    modelId: "operator",
    name: "操作工",
    category: "operator",
    footprint: { w: 600, h: 600 },
    unitCost: 0,
    color: "#fbbf24",
  },
];

export function findTemplate(modelId: string | undefined): EquipmentTemplate | undefined {
  if (!modelId) return undefined;
  return EQUIPMENT_LIBRARY.find((e) => e.modelId === modelId);
}

export const CATEGORY_COLOR: Record<EquipmentCategory, string> = {
  robot: "#f97316",
  weld_gun: "#dc2626",
  spr_gun: "#a855f7",
  fixture: "#10b981",
  conveyor: "#64748b",
  agv: "#0ea5e9",
  operator: "#fbbf24",
  rack: "#94a3b8",
  cell: "#cbd5e1",
  other: "#6b7280",
};
