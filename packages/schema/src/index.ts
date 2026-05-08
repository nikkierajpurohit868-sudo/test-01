/**
 * @ilp/schema — 核心数据模型
 *
 * 设计原则：
 *  - 画布图元 (CanvasItem) 引用 Equipment / ManufacturingElement，绑定关系即数据
 *  - 同一份 Project 数据可派生多种视图：画布 / M+E 清单 / CT 表 / 预算
 *  - 这套 schema 在 M2 时会通过 zod-to-json-schema → Pydantic 同步到后端
 */
import { z } from "zod";

export { nanoid } from "nanoid";

/* ---------- 基础 ---------- */

export const Vec2 = z.object({ x: z.number(), y: z.number() });
export type Vec2 = z.infer<typeof Vec2>;

export const Size = z.object({ w: z.number().positive(), h: z.number().positive() });
export type Size = z.infer<typeof Size>;

/* ---------- 制造特征 ---------- */

export const Feature = z.object({
  id: z.string(),
  name: z.string(),
  /** 例：BIW-Underbody / Closure / Paint-Sealing */
  category: z.string().optional(),
  /** 质量特性目标，自由结构 */
  qualityTargets: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().optional(),
});
export type Feature = z.infer<typeof Feature>;

/* ---------- 制造要素 (M+E 中的 E) ---------- */

export const ManufacturingElementType = z.enum([
  "spr",        // 自冲铆
  "spot_weld",  // 点焊
  "arc_weld",   // 弧焊
  "sealant",    // 涂胶
  "stud",       // 螺柱焊
  "bolt",       // 螺栓紧固
  "inspect",    // 检测
  "other",
]);
export type ManufacturingElementType = z.infer<typeof ManufacturingElementType>;

export const ManufacturingElement = z.object({
  id: z.string(),
  type: ManufacturingElementType,
  /** 关联的制造特征 */
  featureId: z.string().optional(),
  /** 在产品/车体坐标系下的位置（可选） */
  position: Vec2.optional(),
  /** 工艺参数，自由结构（合模力、电流、胶径...） */
  params: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().optional(),
});
export type ManufacturingElement = z.infer<typeof ManufacturingElement>;

/* ---------- 设备 (M+E 中的 M) ---------- */

export const EquipmentCategory = z.enum([
  "robot",
  "weld_gun",
  "spr_gun",
  "fixture",
  "conveyor",
  "agv",
  "operator",
  "rack",
  "cell",
  "other",
]);
export type EquipmentCategory = z.infer<typeof EquipmentCategory>;

export const Equipment = z.object({
  id: z.string(),
  name: z.string(),
  category: EquipmentCategory,
  /** 来自设备库的型号 id */
  modelId: z.string().optional(),
  /** 单价（计入预算） */
  unitCost: z.number().nonnegative().default(0),
  /** 占地包络（mm），用于 2D 画布 */
  footprint: Size.default({ w: 1000, h: 1000 }),
  /** 可达半径（mm），机器人/焊枪类用，做几何可行性 */
  reach: z.number().nonnegative().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export type Equipment = z.infer<typeof Equipment>;

/* ---------- 工序 (CT 表行) ---------- */

export const Operation = z.object({
  id: z.string(),
  name: z.string(),
  /** 所属工位 */
  stationId: z.string().optional(),
  /** 该工序覆盖的制造要素 id */
  elementIds: z.array(z.string()).default([]),
  /** 使用的设备 id */
  equipmentIds: z.array(z.string()).default([]),
  /** 标准工时（秒） */
  cycleTimeSec: z.number().nonnegative().default(0),
  /** MTM/CT 拆解明细，自由结构 */
  ctBreakdown: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().optional(),
});
export type Operation = z.infer<typeof Operation>;

/* ---------- 工位 ---------- */

export const Station = z.object({
  id: z.string(),
  name: z.string(),
  /** 节拍目标（秒），用于平衡分析 */
  targetTaktSec: z.number().nonnegative().optional(),
  /** 画布上的工位边界（可选） */
  bounds: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
});
export type Station = z.infer<typeof Station>;

/* ---------- 画布图元 ---------- */

export const CanvasItemKind = z.enum(["equipment", "element", "annotation", "station", "customBlock"]);
export type CanvasItemKind = z.infer<typeof CanvasItemKind>;

export const CanvasItem = z.object({
  id: z.string(),
  kind: CanvasItemKind,
  /** 引用的业务对象 id（equipmentId / elementId / stationId）*/
  refId: z.string().optional(),
  /** 画布坐标（mm） */
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  /** 渲染尺寸（mm），通常等于 Equipment.footprint */
  w: z.number().positive(),
  h: z.number().positive(),
  layerId: z.string().default("default"),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  /** 标注/文字内容 */
  label: z.string().optional(),
  style: z.record(z.string(), z.unknown()).default({}),
});
export type CanvasItem = z.infer<typeof CanvasItem>;

export const CanvasLayer = z.object({
  id: z.string(),
  name: z.string(),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  /** 类型：产品 / 工艺 / 设备 / 物流 / 底图 */
  kind: z.enum(["product", "process", "equipment", "logistics", "background", "custom"]).default("custom"),
});
export type CanvasLayer = z.infer<typeof CanvasLayer>;

/* ---------- DXF 底图 ---------- */

/**
 * 简化后的 DXF 实体（仅保留 2D 平面规划需要的几何）
 *  - line: [x1,y1,x2,y2]
 *  - polyline: [x1,y1,x2,y2,...] (closed 由 closed 字段标识)
 *  - circle: { cx, cy, r }
 *  - arc: { cx, cy, r, startAngle, endAngle } 角度为弧度
 */
export const DxfEntity = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("line"), points: z.array(z.number()), layer: z.string().optional() }),
  z.object({
    kind: z.literal("polyline"),
    points: z.array(z.number()),
    closed: z.boolean().default(false),
    layer: z.string().optional(),
  }),
  z.object({
    kind: z.literal("circle"),
    cx: z.number(),
    cy: z.number(),
    r: z.number(),
    layer: z.string().optional(),
  }),
  z.object({
    kind: z.literal("arc"),
    cx: z.number(),
    cy: z.number(),
    r: z.number(),
    startAngle: z.number(),
    endAngle: z.number(),
    layer: z.string().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    x: z.number(),
    y: z.number(),
    text: z.string(),
    height: z.number().default(100),
    rotation: z.number().default(0),
    layer: z.string().optional(),
  }),
]);
export type DxfEntity = z.infer<typeof DxfEntity>;

export const DxfBackground = z.object({
  id: z.string(),
  name: z.string(),
  /** zip 内相对路径（M1 可空，几何已 inline） */
  assetPath: z.string().optional(),
  /** 解析后的简化几何（已乘 unitScale，单位 mm） */
  entities: z.array(DxfEntity).default([]),
  /** 包围盒（mm），用于一键居中 */
  bbox: z
    .object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() })
    .optional(),
  /** mm per drawing unit（导入时已乘入 entities，留作记录） */
  unitScale: z.number().positive().default(1),
  origin: Vec2.default({ x: 0, y: 0 }),
  rotation: z.number().default(0),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(0.6),
  /** 线条颜色 */
  color: z.string().default("#475569"),
});
export type DxfBackground = z.infer<typeof DxfBackground>;

/* ---------- 自定义图块库（从 DXF 抽取） ---------- */

export const CustomBlockCategory = z.enum([
  "robot",
  "fixture",
  "conveyor",
  "manual_station",
  "material_buffer",
  "structural",
  "other",
]);
export type CustomBlockCategory = z.infer<typeof CustomBlockCategory>;

/** 安装/挂载方式 */
export const MountType = z.enum([
  "floor",        // 落地
  "ceiling",      // 顶挂（如机器人吊装）
  "wall",         // 壁装
  "on-equipment", // 挂在其他设备上（如夹具挂机床、机器人挂AGV）
  "embedded",     // 内嵌（如导轨埋入地坪）
]);
export type MountType = z.infer<typeof MountType>;

/** 用户自定义属性（visTABLE 风格：name + unit + value + 类型） */
export const UserAttr = z.object({
  key: z.string(),
  label: z.string().default(""),
  unit: z.string().default(""),
  type: z.enum(["number", "text", "bool", "enum"]).default("text"),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).default(""),
  /** type=enum 时的可选值 */
  options: z.array(z.string()).optional(),
});
export type UserAttr = z.infer<typeof UserAttr>;

/** 安全间距 / 干涉避让圈（mm） */
export const Clearance = z.object({
  front: z.number().nonnegative().default(0),
  back: z.number().nonnegative().default(0),
  left: z.number().nonnegative().default(0),
  right: z.number().nonnegative().default(0),
  /** 是否参与干涉检查 */
  enabled: z.boolean().default(true),
});
export type Clearance = z.infer<typeof Clearance>;

/** 工艺/产能参数 */
export const BlockProcess = z.object({
  /** 单件循环时间 s */
  cycleTimeSec: z.number().nonnegative().default(0),
  /** 小时产能（件/h），可空，由 CT 推导 */
  throughputPerHour: z.number().nonnegative().optional(),
  /** 操作工人数 */
  operators: z.number().nonnegative().default(0),
  /** 设备综合效率 OEE 0-1 */
  oee: z.number().min(0).max(1).default(0.85),
  /** 班次数 */
  shiftsPerDay: z.number().nonnegative().default(2),
  /** MTBF/MTTR (h)，可空 */
  mtbfHours: z.number().nonnegative().optional(),
  mttrHours: z.number().nonnegative().optional(),
});
export type BlockProcess = z.infer<typeof BlockProcess>;

/** 成本参数 */
export const BlockCost = z.object({
  /** 一次性投资 ¥ */
  capex: z.number().nonnegative().default(0),
  /** 年运维 ¥/年 */
  opexPerYear: z.number().nonnegative().default(0),
  /** 功率 kW */
  powerKW: z.number().nonnegative().default(0),
  /** 电价 ¥/kWh */
  powerCostPerKWh: z.number().nonnegative().default(0.8),
  /** 占地成本 ¥/m²·年（可选） */
  footprintCostPerM2Year: z.number().nonnegative().optional(),
  /** 货币 */
  currency: z.string().default("CNY"),
});
export type BlockCost = z.infer<typeof BlockCost>;

/** 挂载/层级关系定义 */
export const BlockMounting = z.object({
  type: MountType.default("floor"),
  /** 默认父图块 ID（同 customBlocks 中的 id），为空表示无 */
  parentBlockId: z.string().optional(),
  /** 允许哪些 category 挂载到自己身上（用于拖入吸附） */
  attachableCategories: z.array(CustomBlockCategory).default([]),
  /** 默认挂载相对偏移（mm，相对父块基点） */
  attachOffset: Vec2.default({ x: 0, y: 0 }),
  /** 是否随父移动 */
  followParent: z.boolean().default(true),
});
export type BlockMounting = z.infer<typeof BlockMounting>;

export const CustomBlock = z.object({
  id: z.string(),
  /* ---- identity ---- */
  name: z.string(),
  /** 物料/资产编码 */
  code: z.string().default(""),
  category: CustomBlockCategory.default("other"),
  manufacturer: z.string().default(""),
  model: z.string().default(""),
  version: z.string().default(""),
  tags: z.array(z.string()).default([]),
  description: z.string().default(""),

  /* ---- geometry ---- */
  /** 几何（坐标已平移到块基点为原点，单位 mm） */
  entities: z.array(DxfEntity).default([]),
  /** 局部包围盒（mm） */
  bbox: z.object({
    minX: z.number(),
    minY: z.number(),
    maxX: z.number(),
    maxY: z.number(),
  }),
  /** 占地（W×H mm），默认从 bbox 推导 */
  footprint: z.object({ w: z.number().positive(), h: z.number().positive() }),
  /** 旋转步进（度），0=任意 */
  rotationStep: z.number().nonnegative().default(0),
  /** 是否允许镜像 */
  mirrorable: z.boolean().default(true),
  /** 锚点（基点）相对 bbox 的位置 */
  anchor: Vec2.default({ x: 0, y: 0 }),

  /* ---- planning ---- */
  /** 规划数量（项目目标台数）。实际实例数从 canvasItems 反推。 */
  plannedQty: z.number().nonnegative().default(0),

  /* ---- 6 大业务属性组 ---- */
  clearance: Clearance.default({}),
  process: BlockProcess.default({}),
  cost: BlockCost.default({}),
  mounting: BlockMounting.default({}),
  /** 自定义属性（key-value-unit） */
  userAttrs: z.array(UserAttr).default([]),

  /* ---- visual ---- */
  /** 预览缩略图（data URL，可选） */
  previewDataUrl: z.string().optional(),
  /** 颜色（边框/填充） */
  color: z.string().default("#475569"),

  /* ---- 来源 / 主数据链接 ---- */
  source: z
    .object({
      dxfFile: z.string(),
      blockName: z.string(),
    })
    .optional(),
  /** 知识图谱链接占位（M2 接入设备主数据） */
  equipmentMasterId: z.string().optional(),
  /** 自由扩展元数据（保留向后兼容） */
  metadata: z.record(z.string(), z.unknown()).default({}),

  /* ---- LOD / 瘦身 ---- */
  /** 瘦身前的原始实体（可选，用于"还原"操作）。仅在做过瘦身后写入。 */
  originalEntities: z.array(DxfEntity).optional(),
  /** 当前瘦身配置快照（可重放/审计） */
  slim: z
    .object({
      level: z
        .enum(["none", "light", "medium", "heavy", "silhouette", "custom"])
        .default("none"),
      /** 被丢弃的图层名 */
      dropLayers: z.array(z.string()).default([]),
      /** 被丢弃的实体类型 */
      dropKinds: z
        .array(z.enum(["line", "polyline", "arc", "circle", "text"]))
        .default([]),
      /** 最小线段长度（mm），低于则丢弃 line / polyline */
      minSegmentLen: z.number().nonnegative().default(0),
      /** 最小圆弧/圆半径（mm），低于则丢弃 */
      minRadius: z.number().nonnegative().default(0),
      /** Douglas-Peucker 折线简化阈值（mm），0=关闭 */
      rdpEpsilon: z.number().nonnegative().default(0),
      /** 是否将整体替换为 bbox 矩形轮廓（最激进） */
      replaceWithBBox: z.boolean().default(false),
      /** 上次瘦身的统计 */
      lastBefore: z.number().nonnegative().optional(),
      lastAfter: z.number().nonnegative().optional(),
      lastAt: z.string().optional(),
    })
    .default({}),
});
export type CustomBlock = z.infer<typeof CustomBlock>;
export const SlimOptions = z.object({
  dropLayers: z.array(z.string()).default([]),
  dropKinds: z.array(z.enum(["line", "polyline", "arc", "circle", "text"])).default([]),
  minSegmentLen: z.number().nonnegative().default(0),
  minRadius: z.number().nonnegative().default(0),
  rdpEpsilon: z.number().nonnegative().default(0),
  replaceWithBBox: z.boolean().default(false),
});
export type SlimOptions = z.infer<typeof SlimOptions>;

/* ---------- 项目（顶层聚合根） ---------- */

export const ProjectMeta = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 画布单位，固定 mm */
  unit: z.literal("mm").default("mm"),
});
export type ProjectMeta = z.infer<typeof ProjectMeta>;

export const Project = z.object({
  schemaVersion: z.literal(1).default(1),
  meta: ProjectMeta,
  features: z.array(Feature).default([]),
  elements: z.array(ManufacturingElement).default([]),
  equipment: z.array(Equipment).default([]),
  operations: z.array(Operation).default([]),
  stations: z.array(Station).default([]),
  layers: z.array(CanvasLayer).default([]),
  canvasItems: z.array(CanvasItem).default([]),
  dxfBackgrounds: z.array(DxfBackground).default([]),
  /** 用户从 DXF 抽取的自定义图块库（项目内可见） */
  customBlocks: z.array(CustomBlock).default([]),
});
export type Project = z.infer<typeof Project>;

/* ---------- 工厂函数 ---------- */

import { nanoid as _nanoid } from "nanoid";

export function newProject(name = "未命名项目"): Project {
  const now = new Date().toISOString();
  return Project.parse({
    schemaVersion: 1,
    meta: { id: _nanoid(), name, description: "", createdAt: now, updatedAt: now, unit: "mm" },
    layers: [
      { id: "background", name: "底图", kind: "background", visible: true, locked: true },
      { id: "default", name: "设备", kind: "equipment", visible: true, locked: false },
    ],
  });
}
