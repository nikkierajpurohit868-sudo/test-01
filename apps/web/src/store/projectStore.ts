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
  newProject,
} from "@ilp/schema";
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
      if (it) Object.assign(it, patch);
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
