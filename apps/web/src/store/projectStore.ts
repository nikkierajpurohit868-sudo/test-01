/**
 * 项目状态：单一真相源
 *  - 画布、设备、M+E、CT 都从这里派生
 *  - 所有 mutation 走 produce（immer）
 *  - 自动持久化到 IndexedDB（debounced）
 */
import { create } from "zustand";
import { produce } from "immer";
import { nanoid } from "nanoid";
import {
  type Project,
  type Equipment,
  type CanvasItem,
  type ManufacturingElement,
  type Operation,
  type Station,
  type DxfBackground,
  type CustomBlock,
  type SlimOptions,
  CustomBlock as CustomBlockSchema,
  newProject,
} from "@ilp/schema";
import { slimEntities, presetOptions, type SlimPreset } from "@/lib/slimBlock";
import { computeMotionTime } from "@/lib/motionTime";
import type { DxfEntity, MotionPath, Waypoint } from "@ilp/schema";

/** addCustomBlocks 接受的输入类型：复用 zod schema 的 input 类型（默认字段可省略） */
export type CustomBlockInput = Omit<Parameters<typeof CustomBlockSchema.parse>[0], "id">;
import { findTemplate, type EquipmentTemplate } from "@/lib/equipmentLibrary";
import { saveProject } from "@/db/dexie";

interface ProjectStore {
  project: Project;
  selectedItemId: string | null;
  /** UI 偏好：网格吸附步长（mm），0=关 */
  snapStep: number;
  setSnapStep: (s: number) => void;

  // ------- 项目级 -------
  loadProject: (p: Project) => void;
  resetProject: () => void;
  renameProject: (name: string) => void;

  // ------- 画布 / 设备 -------
  /** 从设备库拖入：自动生成 Equipment + CanvasItem 双胞胎 */
  addEquipmentFromTemplate: (tpl: EquipmentTemplate, x: number, y: number) => string;
  updateCanvasItem: (id: string, patch: Partial<CanvasItem>) => void;
  updateEquipment: (id: string, patch: Partial<Equipment>) => void;
  deleteCanvasItem: (id: string) => void;
  selectItem: (id: string | null) => void;

  // ------- 工位 / 工序 / M+E -------
  addStation: () => string;
  updateStation: (id: string, patch: Partial<Station>) => void;
  deleteStation: (id: string) => void;

  addOperation: (stationId?: string) => string;
  updateOperation: (id: string, patch: Partial<Operation>) => void;
  deleteOperation: (id: string) => void;

  addElement: (type: ManufacturingElement["type"]) => string;
  updateElement: (id: string, patch: Partial<ManufacturingElement>) => void;
  deleteElement: (id: string) => void;

  // ------- DXF 底图 -------
  addDxfBackground: (bg: Omit<DxfBackground, "id">) => string;
  updateDxfBackground: (id: string, patch: Partial<DxfBackground>) => void;
  deleteDxfBackground: (id: string) => void;

  // ------- 自定义图块库 -------
  addCustomBlocks: (blocks: CustomBlockInput[]) => string[];
  updateCustomBlock: (id: string, patch: Partial<CustomBlock>) => void;
  deleteCustomBlock: (id: string) => void;
  /** 拖入画布：实例化一个 CustomBlock */
  addCanvasItemFromCustomBlock: (block: CustomBlock, x: number, y: number) => string;
  /** 瘦身：自定义参数 */
  slimCustomBlock: (
    id: string,
    opts: SlimOptions,
    level?: CustomBlock["slim"]["level"]
  ) => { before: number; after: number } | null;
  /** 瘦身：使用预设 */
  slimCustomBlockPreset: (
    id: string,
    preset: SlimPreset
  ) => { before: number; after: number } | null;
  /** 还原到瘦身前 */
  restoreCustomBlock: (id: string) => boolean;
  /** 批量瘦身：仅对 entities 数 >= threshold 的图块应用预设 */
  slimAllCustomBlocks: (
    preset: SlimPreset,
    threshold: number
  ) => { affected: number; before: number; after: number };
  /** 直接覆盖图块的 entities（橡皮擦/区域瘦身的统一提交点）；首次会备份 originalEntities */
  applyBlockEntities: (id: string, entities: DxfEntity[]) => void;

  // ------- 操作动线 -------
  /** 当前选中的动线（与 selectedItemId 互斥） */
  selectedPathId: string | null;
  selectPath: (id: string | null) => void;
  /** UI 工具状态：当前是否处于"绘制动线"模式 */
  drawingMotionPath: { activeId: string | null } | null;
  startDrawMotionPath: () => string;
  finishDrawMotionPath: () => void;
  cancelDrawMotionPath: () => void;

  addMotionPath: (init?: Partial<Omit<MotionPath, "id">>) => string;
  updateMotionPath: (id: string, patch: Partial<MotionPath>) => void;
  deleteMotionPath: (id: string) => void;
  appendWaypoint: (pathId: string, wp: Waypoint) => void;
  moveWaypoint: (pathId: string, idx: number, wp: Partial<Waypoint>) => void;
  removeWaypoint: (pathId: string, idx: number) => void;
  insertWaypoint: (pathId: string, idx: number, wp: Waypoint) => void;
  /** 重新计算指定路径的派生字段 */
  recomputeMotionPath: (id: string) => void;
  /** 重算所有路径（用于 anchor 移动 / 默认值变更） */
  recomputeAllMotionPaths: () => void;
}

let saveTimer: number | undefined;
function scheduleSave(p: Project) {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveProject(p);
  }, 300);
}

export const useProjectStore = create<ProjectStore>()((set, _get) => {
  const mutate = (mutator: (p: Project) => void) =>
    set((state) => {
      const next = produce(state.project, (draft) => {
        mutator(draft);
        draft.meta.updatedAt = new Date().toISOString();
      });
      scheduleSave(next);
      return { project: next };
    });

  return ({
  project: newProject(),
  selectedItemId: null,
  snapStep: 100,
  setSnapStep: (s) => set({ snapStep: Math.max(0, s) }),

  loadProject: (p) => set(() => ({ project: p, selectedItemId: null })),
  resetProject: () => {
    const p = newProject();
    set({ project: p, selectedItemId: null });
    scheduleSave(p);
  },
  renameProject: (name) => mutate((p) => { p.meta.name = name; }),

  addEquipmentFromTemplate: (tpl, x, y) => {
    const eqId = nanoid();
    const itemId = nanoid();
    mutate((p) => {
      const eq: Equipment = {
        id: eqId,
        name: tpl.name,
        category: tpl.category,
        modelId: tpl.modelId,
        unitCost: tpl.unitCost,
        footprint: tpl.footprint,
        reach: tpl.reach,
        attributes: {},
      };
      p.equipment.push(eq);
      const item: CanvasItem = {
        id: itemId,
        kind: "equipment",
        refId: eqId,
        x,
        y,
        rotation: 0,
        w: tpl.footprint.w,
        h: tpl.footprint.h,
        layerId: "default",
        locked: false,
        visible: true,
        label: tpl.name,
        style: { fill: tpl.color },
      };
      p.canvasItems.push(item);
    });
    set({ selectedItemId: itemId });
    return itemId;
  },

  updateCanvasItem: (id, patch) =>
    mutate((p) => {
      const it = p.canvasItems.find((i) => i.id === id);
      if (!it) return;
      Object.assign(it, patch);
      // 若有动线 anchor 到此 item，则触发重算
      const affected = p.motionPaths.filter((mp) =>
        mp.waypoints.some((wp) => wp.anchorItemId === id)
      );
      for (const mp of affected) {
        mp.derived = computeMotionTime(mp, {
          defaults: p.meta.motionDefaults,
          items: p.canvasItems,
        });
      }
    }),

  updateEquipment: (id, patch) =>
    mutate((p) => {
      const eq = p.equipment.find((e) => e.id === id);
      if (!eq) return;
      Object.assign(eq, patch);
      // 同步到 canvasItem 渲染尺寸
      if (patch.footprint) {
        for (const it of p.canvasItems) {
          if (it.kind === "equipment" && it.refId === id) {
            it.w = patch.footprint.w;
            it.h = patch.footprint.h;
          }
        }
      }
      if (patch.name) {
        for (const it of p.canvasItems) {
          if (it.kind === "equipment" && it.refId === id) it.label = patch.name;
        }
      }
    }),

  deleteCanvasItem: (id) =>
    mutate((p) => {
      const it = p.canvasItems.find((i) => i.id === id);
      if (!it) return;
      p.canvasItems = p.canvasItems.filter((i) => i.id !== id);
      if (it.kind === "equipment" && it.refId) {
        p.equipment = p.equipment.filter((e) => e.id !== it.refId);
      }
    }),

  selectItem: (id) => set({ selectedItemId: id }),

  addStation: () => {
    const id = nanoid();
    mutate((p) => {
      p.stations.push({ id, name: `工位${p.stations.length + 1}`, targetTaktSec: 60 });
    });
    return id;
  },
  updateStation: (id, patch) =>
    mutate((p) => {
      const s = p.stations.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    }),
  deleteStation: (id) =>
    mutate((p) => {
      p.stations = p.stations.filter((s) => s.id !== id);
      for (const op of p.operations) if (op.stationId === id) op.stationId = undefined;
    }),

  addOperation: (stationId) => {
    const id = nanoid();
    mutate((p) => {
      p.operations.push({
        id,
        name: `工序${p.operations.length + 1}`,
        stationId,
        elementIds: [],
        equipmentIds: [],
        cycleTimeSec: 0,
        ctBreakdown: {},
      });
    });
    return id;
  },
  updateOperation: (id, patch) =>
    mutate((p) => {
      const op = p.operations.find((x) => x.id === id);
      if (op) Object.assign(op, patch);
    }),
  deleteOperation: (id) =>
    mutate((p) => {
      p.operations = p.operations.filter((o) => o.id !== id);
    }),

  addElement: (type) => {
    const id = nanoid();
    mutate((p) => {
      p.elements.push({ id, type, params: {} });
    });
    return id;
  },
  updateElement: (id, patch) =>
    mutate((p) => {
      const e = p.elements.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    }),
  deleteElement: (id) =>
    mutate((p) => {
      p.elements = p.elements.filter((e) => e.id !== id);
    }),

  addDxfBackground: (bg) => {
    const id = nanoid();
    mutate((p) => {
      p.dxfBackgrounds.push({ ...bg, id });
    });
    return id;
  },
  updateDxfBackground: (id, patch) =>
    mutate((p) => {
      const b = p.dxfBackgrounds.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
    }),
  deleteDxfBackground: (id) =>
    mutate((p) => {
      p.dxfBackgrounds = p.dxfBackgrounds.filter((b) => b.id !== id);
    }),

  addCustomBlocks: (blocks) => {
    const ids: string[] = [];
    mutate((p) => {
      for (const b of blocks) {
        const id = nanoid();
        ids.push(id);
        // 用 zod 解析补齐 clearance/process/cost/mounting 等默认值
        const parsed = CustomBlockSchema.parse({ ...b, id });
        p.customBlocks.push(parsed);
      }
    });
    return ids;
  },
  updateCustomBlock: (id, patch) =>
    mutate((p) => {
      const b = p.customBlocks.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
    }),
  deleteCustomBlock: (id) =>
    mutate((p) => {
      p.customBlocks = p.customBlocks.filter((b) => b.id !== id);
    }),

  slimCustomBlock: (id, opts, level = "custom") => {
    let result: { before: number; after: number } | null = null;
    mutate((p) => {
      const b = p.customBlocks.find((x) => x.id === id);
      if (!b) return;
      // 始终基于 originalEntities（首次瘦身则把当前 entities 作为 backup）
      if (!b.originalEntities) b.originalEntities = b.entities.slice();
      const r = slimEntities(b.originalEntities, b.bbox, opts);
      b.entities = r.entities;
      // 注意：previewDataUrl 与 footprint 暂不重算，瘦身不应改变占位
      b.slim = {
        level,
        dropLayers: opts.dropLayers ?? [],
        dropKinds: opts.dropKinds ?? [],
        minSegmentLen: opts.minSegmentLen ?? 0,
        minRadius: opts.minRadius ?? 0,
        rdpEpsilon: opts.rdpEpsilon ?? 0,
        replaceWithBBox: opts.replaceWithBBox ?? false,
        lastBefore: r.before,
        lastAfter: r.after,
        lastAt: new Date().toISOString(),
      };
      result = { before: r.before, after: r.after };
    });
    return result;
  },

  slimCustomBlockPreset: (id, preset) => {
    let result: { before: number; after: number } | null = null;
    mutate((p) => {
      const b = p.customBlocks.find((x) => x.id === id);
      if (!b) return;
      if (!b.originalEntities) b.originalEntities = b.entities.slice();
      const opts = presetOptions(preset, b.bbox);
      const r = slimEntities(b.originalEntities, b.bbox, opts);
      b.entities = r.entities;
      b.slim = {
        level: preset,
        dropLayers: opts.dropLayers,
        dropKinds: opts.dropKinds,
        minSegmentLen: opts.minSegmentLen,
        minRadius: opts.minRadius,
        rdpEpsilon: opts.rdpEpsilon,
        replaceWithBBox: opts.replaceWithBBox,
        lastBefore: r.before,
        lastAfter: r.after,
        lastAt: new Date().toISOString(),
      };
      result = { before: r.before, after: r.after };
    });
    return result;
  },

  restoreCustomBlock: (id) => {
    let ok = false;
    mutate((p) => {
      const b = p.customBlocks.find((x) => x.id === id);
      if (!b || !b.originalEntities) return;
      b.entities = b.originalEntities.slice();
      delete b.originalEntities;
      b.slim = {
        level: "none",
        dropLayers: [],
        dropKinds: [],
        minSegmentLen: 0,
        minRadius: 0,
        rdpEpsilon: 0,
        replaceWithBBox: false,
      };
      ok = true;
    });
    return ok;
  },

  slimAllCustomBlocks: (preset, threshold) => {
    let affected = 0;
    let before = 0;
    let after = 0;
    mutate((p) => {
      for (const b of p.customBlocks) {
        const src = b.originalEntities ?? b.entities;
        if (src.length < threshold) continue;
        if (!b.originalEntities) b.originalEntities = b.entities.slice();
        const opts = presetOptions(preset, b.bbox);
        const r = slimEntities(b.originalEntities, b.bbox, opts);
        b.entities = r.entities;
        b.slim = {
          level: preset,
          dropLayers: opts.dropLayers,
          dropKinds: opts.dropKinds,
          minSegmentLen: opts.minSegmentLen,
          minRadius: opts.minRadius,
          rdpEpsilon: opts.rdpEpsilon,
          replaceWithBBox: opts.replaceWithBBox,
          lastBefore: r.before,
          lastAfter: r.after,
          lastAt: new Date().toISOString(),
        };
        affected += 1;
        before += r.before;
        after += r.after;
      }
    });
    return { affected, before, after };
  },

  applyBlockEntities: (id, entities) =>
    mutate((p) => {
      const b = p.customBlocks.find((x) => x.id === id);
      if (!b) return;
      if (!b.originalEntities) b.originalEntities = b.entities.slice();
      b.entities = entities;
      b.slim = {
        ...b.slim,
        level: "custom",
        lastBefore: b.originalEntities.length,
        lastAfter: entities.length,
        lastAt: new Date().toISOString(),
      };
    }),

  addCanvasItemFromCustomBlock: (block, x, y) => {
    const itemId = nanoid();
    mutate((p) => {
      p.canvasItems.push({
        id: itemId,
        kind: "customBlock",
        refId: block.id,
        x,
        y,
        w: block.footprint.w,
        h: block.footprint.h,
        rotation: 0,
        layerId: "default",
        visible: true,
        locked: false,
        label: block.name,
        style: {},
      });
    });
    return itemId;
  },

  /* ==================== 操作动线 ==================== */

  selectedPathId: null,
  selectPath: (id) => set({ selectedPathId: id, selectedItemId: id ? null : _get().selectedItemId }),

  drawingMotionPath: null,

  startDrawMotionPath: () => {
    const id = nanoid();
    mutate((p) => {
      const mp: MotionPath = {
        id,
        name: `动线${p.motionPaths.length + 1}`,
        color: "#0ea5e9",
        // 起始两个占位点；用户首点后会被替换
        waypoints: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
        motionType: p.meta.motionDefaults.defaultMotionType,
        standardMode: p.meta.motionDefaults.standardMode,
        endpointActions: [],
        visible: true,
        locked: false,
      };
      p.motionPaths.push(mp);
    });
    set({ drawingMotionPath: { activeId: id } });
    return id;
  },
  finishDrawMotionPath: () =>
    set((s) => {
      const id = s.drawingMotionPath?.activeId;
      if (!id) return { drawingMotionPath: null };
      const next = produce(s.project, (p) => {
        const mp = p.motionPaths.find((m) => m.id === id);
        if (!mp) return;
        // 如果只有不到 2 个 waypoint，删除这条空路径
        if (mp.waypoints.length < 2) {
          p.motionPaths = p.motionPaths.filter((m) => m.id !== id);
          return;
        }
        mp.derived = computeMotionTime(mp, {
          defaults: p.meta.motionDefaults,
          items: p.canvasItems,
        });
      });
      scheduleSave(next);
      return { project: next, drawingMotionPath: null };
    }),
  cancelDrawMotionPath: () =>
    set((s) => {
      const id = s.drawingMotionPath?.activeId;
      if (!id) return { drawingMotionPath: null };
      const next = produce(s.project, (p) => {
        p.motionPaths = p.motionPaths.filter((m) => m.id !== id);
      });
      scheduleSave(next);
      return { project: next, drawingMotionPath: null };
    }),

  addMotionPath: (init = {}) => {
    const id = nanoid();
    mutate((p) => {
      const mp: MotionPath = {
        id,
        name: init.name ?? `动线${p.motionPaths.length + 1}`,
        color: init.color ?? "#0ea5e9",
        waypoints: init.waypoints ?? [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
        ],
        motionType: init.motionType ?? p.meta.motionDefaults.defaultMotionType,
        standardMode: init.standardMode ?? p.meta.motionDefaults.standardMode,
        customSpeed: init.customSpeed,
        customAllowance: init.customAllowance,
        endpointActions: init.endpointActions ?? [],
        operationId: init.operationId,
        stationId: init.stationId,
        visible: init.visible ?? true,
        locked: init.locked ?? false,
      };
      mp.derived = computeMotionTime(mp, {
        defaults: p.meta.motionDefaults,
        items: p.canvasItems,
      });
      p.motionPaths.push(mp);
    });
    return id;
  },

  updateMotionPath: (id, patch) =>
    mutate((p) => {
      const mp = p.motionPaths.find((m) => m.id === id);
      if (!mp) return;
      Object.assign(mp, patch);
      mp.derived = computeMotionTime(mp, {
        defaults: p.meta.motionDefaults,
        items: p.canvasItems,
      });
    }),

  deleteMotionPath: (id) =>
    mutate((p) => {
      p.motionPaths = p.motionPaths.filter((m) => m.id !== id);
    }),

  appendWaypoint: (pathId, wp) =>
    mutate((p) => {
      const mp = p.motionPaths.find((m) => m.id === pathId);
      if (!mp) return;
      mp.waypoints.push(wp);
      mp.derived = computeMotionTime(mp, {
        defaults: p.meta.motionDefaults,
        items: p.canvasItems,
      });
    }),

  moveWaypoint: (pathId, idx, wp) =>
    mutate((p) => {
      const mp = p.motionPaths.find((m) => m.id === pathId);
      if (!mp) return;
      const cur = mp.waypoints[idx];
      if (!cur) return;
      mp.waypoints[idx] = { ...cur, ...wp };
      mp.derived = computeMotionTime(mp, {
        defaults: p.meta.motionDefaults,
        items: p.canvasItems,
      });
    }),

  removeWaypoint: (pathId, idx) =>
    mutate((p) => {
      const mp = p.motionPaths.find((m) => m.id === pathId);
      if (!mp || mp.waypoints.length <= 2) return; // 至少保留 2 点
      mp.waypoints.splice(idx, 1);
      mp.derived = computeMotionTime(mp, {
        defaults: p.meta.motionDefaults,
        items: p.canvasItems,
      });
    }),

  insertWaypoint: (pathId, idx, wp) =>
    mutate((p) => {
      const mp = p.motionPaths.find((m) => m.id === pathId);
      if (!mp) return;
      mp.waypoints.splice(idx, 0, wp);
      mp.derived = computeMotionTime(mp, {
        defaults: p.meta.motionDefaults,
        items: p.canvasItems,
      });
    }),

  recomputeMotionPath: (id) =>
    mutate((p) => {
      const mp = p.motionPaths.find((m) => m.id === id);
      if (!mp) return;
      mp.derived = computeMotionTime(mp, {
        defaults: p.meta.motionDefaults,
        items: p.canvasItems,
      });
    }),

  recomputeAllMotionPaths: () =>
    mutate((p) => {
      for (const mp of p.motionPaths) {
        mp.derived = computeMotionTime(mp, {
          defaults: p.meta.motionDefaults,
          items: p.canvasItems,
        });
      }
    }),
  });
});

/** Selectors */
export const selectSelectedItem = (s: ProjectStore) =>
  s.selectedItemId ? s.project.canvasItems.find((i) => i.id === s.selectedItemId) ?? null : null;

export const selectSelectedEquipment = (s: ProjectStore): Equipment | null => {
  const it = selectSelectedItem(s);
  if (!it || it.kind !== "equipment" || !it.refId) return null;
  return s.project.equipment.find((e) => e.id === it.refId) ?? null;
};

export { findTemplate };
