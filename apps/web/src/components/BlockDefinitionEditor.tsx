/**
 * 图块定义编辑器：模态框 + 6 个标签页
 *  对标 visTABLE / FactoryCAD / Autodesk FDU 的 Asset 属性体系。
 *  按用户需求覆盖：名称、数量、干涉、工时、费用、挂载关系、自定义属性。
 */
import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, Zap, RotateCcw, Eraser } from "lucide-react";
import type { CustomBlock, CustomBlockCategory, MountType, UserAttr } from "@ilp/schema";
import { useProjectStore } from "@/store/projectStore";
import { statEntities, type SlimPreset } from "@/lib/slimBlock";
import { BlockEraserCanvas } from "@/components/BlockEraserCanvas";

const CATEGORY_LABEL: Record<CustomBlockCategory, string> = {
  robot: "机器人",
  fixture: "夹具",
  conveyor: "输送",
  manual_station: "工位",
  material_buffer: "缓存",
  structural: "建筑",
  other: "其他",
};

const MOUNT_LABEL: Record<MountType, string> = {
  floor: "落地",
  ceiling: "顶挂",
  wall: "壁装",
  "on-equipment": "挂载于其他设备",
  embedded: "内嵌",
};

type TabKey =
  | "basic"
  | "process"
  | "clearance"
  | "cost"
  | "mounting"
  | "custom"
  | "slim";

const TABS: { key: TabKey; label: string }[] = [
  { key: "basic", label: "基本" },
  { key: "process", label: "工艺/工时" },
  { key: "clearance", label: "干涉/安全" },
  { key: "cost", label: "费用" },
  { key: "mounting", label: "挂载关系" },
  { key: "custom", label: "自定义属性" },
  { key: "slim", label: "瘦身/LOD" },
];

export interface BlockDefinitionEditorProps {
  blockId: string;
  onClose: () => void;
}

export function BlockDefinitionEditor({ blockId, onClose }: BlockDefinitionEditorProps) {
  const block = useProjectStore((s) => s.project.customBlocks.find((b) => b.id === blockId));
  const allBlocks = useProjectStore((s) => s.project.customBlocks);
  const canvasItems = useProjectStore((s) => s.project.canvasItems);
  const updateBlock = useProjectStore((s) => s.updateCustomBlock);

  const [tab, setTab] = useState<TabKey>("basic");
  const [draft, setDraft] = useState<CustomBlock | null>(block ?? null);

  useEffect(() => {
    if (block) setDraft(block);
  }, [block]);

  /** 实际画布实例数（只读） */
  const instanceCount = useMemo(
    () => canvasItems.filter((i) => i.kind === "customBlock" && i.refId === blockId).length,
    [canvasItems, blockId]
  );

  if (!block || !draft) {
    return null;
  }

  const patch = <K extends keyof CustomBlock>(key: K, val: CustomBlock[K]) =>
    setDraft((d) => (d ? { ...d, [key]: val } : d));

  const save = () => {
    updateBlock(blockId, draft);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-full max-h-[760px] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        {/* 头 */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <div className="flex items-center gap-2">
            {draft.previewDataUrl && (
              <img src={draft.previewDataUrl} alt="" className="h-8 w-8 rounded border border-slate-200 bg-slate-50" />
            )}
            <div>
              <div className="text-sm font-semibold text-slate-800">编辑图块定义</div>
              <div className="text-[11px] text-slate-500">
                {draft.name} · 当前画布 <b>{instanceCount}</b> 个实例
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "px-3 py-1.5 text-xs border-b-2 -mb-px " +
                (tab === t.key
                  ? "border-sky-500 text-slate-800 font-semibold"
                  : "border-transparent text-slate-500 hover:text-slate-700")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-4 text-xs">
          {tab === "basic" && (
            <BasicTab draft={draft} patch={patch} instanceCount={instanceCount} />
          )}
          {tab === "process" && <ProcessTab draft={draft} patch={patch} />}
          {tab === "clearance" && <ClearanceTab draft={draft} patch={patch} />}
          {tab === "cost" && <CostTab draft={draft} patch={patch} />}
          {tab === "mounting" && (
            <MountingTab draft={draft} patch={patch} allBlocks={allBlocks} />
          )}
          {tab === "custom" && <CustomAttrsTab draft={draft} patch={patch} />}
          {tab === "slim" && <SlimTab blockId={blockId} />}
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
            取消
          </button>
          <button onClick={save} className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========== 各 Tab ========== */

type PatchFn = <K extends keyof CustomBlock>(k: K, v: CustomBlock[K]) => void;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  "rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-200";

function BasicTab({
  draft,
  patch,
  instanceCount,
}: {
  draft: CustomBlock;
  patch: PatchFn;
  instanceCount: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="名称 *">
        <input className={inputCls} value={draft.name} onChange={(e) => patch("name", e.target.value)} />
      </Field>
      <Field label="编码 / 物料号">
        <input className={inputCls} value={draft.code} onChange={(e) => patch("code", e.target.value)} />
      </Field>
      <Field label="分类">
        <select
          className={inputCls}
          value={draft.category}
          onChange={(e) => patch("category", e.target.value as CustomBlockCategory)}
        >
          {(Object.keys(CATEGORY_LABEL) as CustomBlockCategory[]).map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="厂商">
        <input
          className={inputCls}
          value={draft.manufacturer}
          onChange={(e) => patch("manufacturer", e.target.value)}
        />
      </Field>
      <Field label="型号">
        <input className={inputCls} value={draft.model} onChange={(e) => patch("model", e.target.value)} />
      </Field>
      <Field label="版本">
        <input className={inputCls} value={draft.version} onChange={(e) => patch("version", e.target.value)} />
      </Field>
      <Field label="标签（逗号分隔）" hint="便于检索/分组">
        <input
          className={inputCls}
          value={draft.tags.join(",")}
          onChange={(e) =>
            patch(
              "tags",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
        />
      </Field>
      <Field label="颜色">
        <input
          type="color"
          className="h-7 w-16 rounded border border-slate-300"
          value={draft.color}
          onChange={(e) => patch("color", e.target.value)}
        />
      </Field>

      <Field label="规划数量（目标台数）" hint={`画布当前实际 ${instanceCount} 个`}>
        <input
          type="number"
          min={0}
          className={inputCls}
          value={draft.plannedQty}
          onChange={(e) => patch("plannedQty", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="占地（mm）" hint={`bbox: ${(draft.footprint.w).toFixed(0)} × ${(draft.footprint.h).toFixed(0)}`}>
        <div className="flex items-center gap-1">
          <input
            type="number"
            className={`${inputCls} w-full`}
            value={Math.round(draft.footprint.w)}
            onChange={(e) =>
              patch("footprint", { ...draft.footprint, w: Math.max(1, Number(e.target.value) || 1) })
            }
          />
          <span className="text-slate-400">×</span>
          <input
            type="number"
            className={`${inputCls} w-full`}
            value={Math.round(draft.footprint.h)}
            onChange={(e) =>
              patch("footprint", { ...draft.footprint, h: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </div>
      </Field>

      <Field label="旋转步进（°）" hint="0=任意角度">
        <input
          type="number"
          min={0}
          step={15}
          className={inputCls}
          value={draft.rotationStep}
          onChange={(e) => patch("rotationStep", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="允许镜像">
        <select
          className={inputCls}
          value={draft.mirrorable ? "1" : "0"}
          onChange={(e) => patch("mirrorable", e.target.value === "1")}
        >
          <option value="1">是</option>
          <option value="0">否</option>
        </select>
      </Field>

      <div className="col-span-2">
        <Field label="描述">
          <textarea
            rows={2}
            className={inputCls}
            value={draft.description}
            onChange={(e) => patch("description", e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function ProcessTab({ draft, patch }: { draft: CustomBlock; patch: PatchFn }) {
  const p = draft.process;
  const set = (k: keyof typeof p, v: number | undefined) =>
    patch("process", { ...p, [k]: v as never });

  // 派生：理论小时产能 ≈ 3600 / CT × OEE
  const derived =
    p.cycleTimeSec > 0 ? Math.round((3600 / p.cycleTimeSec) * (p.oee || 1)) : 0;

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="单件循环时间 CT (s)">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={p.cycleTimeSec}
          onChange={(e) => set("cycleTimeSec", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="小时产能（件/h）" hint={`留空使用派生值: ${derived}`}>
        <input
          type="number"
          min={0}
          className={inputCls}
          value={p.throughputPerHour ?? ""}
          onChange={(e) =>
            set("throughputPerHour", e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </Field>
      <Field label="操作工人数">
        <input
          type="number"
          min={0}
          step={0.5}
          className={inputCls}
          value={p.operators}
          onChange={(e) => set("operators", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="OEE (0–1)">
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          className={inputCls}
          value={p.oee}
          onChange={(e) => set("oee", Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
        />
      </Field>
      <Field label="班次数 / 天">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={p.shiftsPerDay}
          onChange={(e) => set("shiftsPerDay", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="MTBF (h)">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={p.mtbfHours ?? ""}
          onChange={(e) =>
            set("mtbfHours", e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </Field>
      <Field label="MTTR (h)">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={p.mttrHours ?? ""}
          onChange={(e) =>
            set("mttrHours", e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </Field>
    </div>
  );
}

function ClearanceTab({ draft, patch }: { draft: CustomBlock; patch: PatchFn }) {
  const c = draft.clearance;
  const set = (k: keyof typeof c, v: number | boolean) =>
    patch("clearance", { ...c, [k]: v as never });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={c.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        <span>启用干涉/安全间距检查（拖动时若与其他启用项重叠则报警）</span>
      </label>

      <div className="rounded border border-slate-200 bg-slate-50 p-3">
        <div className="mb-2 text-[11px] font-semibold text-slate-600">安全间距（mm，绕图块四周）</div>
        <div className="grid grid-cols-3 items-center gap-2">
          <div />
          <Field label="前 / 上">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={c.front}
              onChange={(e) => set("front", Number(e.target.value) || 0)}
            />
          </Field>
          <div />
          <Field label="左">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={c.left}
              onChange={(e) => set("left", Number(e.target.value) || 0)}
            />
          </Field>
          <div className="flex h-12 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-[10px] text-slate-400">
            图块本体
          </div>
          <Field label="右">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={c.right}
              onChange={(e) => set("right", Number(e.target.value) || 0)}
            />
          </Field>
          <div />
          <Field label="后 / 下">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={c.back}
              onChange={(e) => set("back", Number(e.target.value) || 0)}
            />
          </Field>
          <div />
        </div>
      </div>
    </div>
  );
}

function CostTab({ draft, patch }: { draft: CustomBlock; patch: PatchFn }) {
  const c = draft.cost;
  const set = (k: keyof typeof c, v: number | string | undefined) =>
    patch("cost", { ...c, [k]: v as never });
  const annualEnergy = c.powerKW * 24 * 365 * c.powerCostPerKWh; // 估算

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="货币">
        <input className={inputCls} value={c.currency} onChange={(e) => set("currency", e.target.value)} />
      </Field>
      <Field label="一次性投资 CAPEX">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={c.capex}
          onChange={(e) => set("capex", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="年运维 OPEX (¥/年)">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={c.opexPerYear}
          onChange={(e) => set("opexPerYear", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="功率 (kW)">
        <input
          type="number"
          min={0}
          step={0.1}
          className={inputCls}
          value={c.powerKW}
          onChange={(e) => set("powerKW", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="电价 (¥/kWh)">
        <input
          type="number"
          min={0}
          step={0.01}
          className={inputCls}
          value={c.powerCostPerKWh}
          onChange={(e) => set("powerCostPerKWh", Number(e.target.value) || 0)}
        />
      </Field>
      <Field label="占地成本 (¥/m²·年，可选)">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={c.footprintCostPerM2Year ?? ""}
          onChange={(e) =>
            set("footprintCostPerM2Year", e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </Field>
      <div className="col-span-2 rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-600">
        <div>派生 · 满载年电费 ≈ <b>{annualEnergy.toLocaleString()}</b> {c.currency}</div>
        <div>派生 · 占地 ≈ <b>{((draft.footprint.w * draft.footprint.h) / 1e6).toFixed(2)}</b> m²</div>
      </div>
    </div>
  );
}

function MountingTab({
  draft,
  patch,
  allBlocks,
}: {
  draft: CustomBlock;
  patch: PatchFn;
  allBlocks: CustomBlock[];
}) {
  const m = draft.mounting;
  const set = <K extends keyof typeof m>(k: K, v: (typeof m)[K]) =>
    patch("mounting", { ...m, [k]: v });
  const candidates = allBlocks.filter((b) => b.id !== draft.id);

  const toggleCat = (cat: CustomBlockCategory) => {
    const has = m.attachableCategories.includes(cat);
    set(
      "attachableCategories",
      has ? m.attachableCategories.filter((c) => c !== cat) : [...m.attachableCategories, cat]
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="安装方式">
          <select
            className={inputCls}
            value={m.type}
            onChange={(e) => set("type", e.target.value as MountType)}
          >
            {(Object.keys(MOUNT_LABEL) as MountType[]).map((k) => (
              <option key={k} value={k}>
                {MOUNT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="默认父图块" hint="拖入画布时如果靠近父块则自动吸附">
          <select
            className={inputCls}
            value={m.parentBlockId ?? ""}
            onChange={(e) => set("parentBlockId", e.target.value || undefined)}
          >
            <option value="">— 无 —</option>
            {candidates.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({CATEGORY_LABEL[b.category]})
              </option>
            ))}
          </select>
        </Field>
        <Field label="默认相对偏移 X (mm)">
          <input
            type="number"
            className={inputCls}
            value={m.attachOffset.x}
            onChange={(e) => set("attachOffset", { ...m.attachOffset, x: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="默认相对偏移 Y (mm)">
          <input
            type="number"
            className={inputCls}
            value={m.attachOffset.y}
            onChange={(e) => set("attachOffset", { ...m.attachOffset, y: Number(e.target.value) || 0 })}
          />
        </Field>
        <Field label="随父移动">
          <select
            className={inputCls}
            value={m.followParent ? "1" : "0"}
            onChange={(e) => set("followParent", e.target.value === "1")}
          >
            <option value="1">是</option>
            <option value="0">否</option>
          </select>
        </Field>
      </div>

      <div className="rounded border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1 text-[11px] font-semibold text-slate-600">允许哪些分类挂载到本图块上</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CATEGORY_LABEL) as CustomBlockCategory[]).map((cat) => {
            const on = m.attachableCategories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCat(cat)}
                className={
                  "rounded border px-2 py-0.5 text-[11px] " +
                  (on
                    ? "border-sky-500 bg-sky-100 text-sky-700"
                    : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100")
                }
              >
                {CATEGORY_LABEL[cat]}
              </button>
            );
          })}
        </div>
        <div className="mt-1 text-[10px] text-slate-400">
          示例：机器人勾选"夹具/工位"，则夹具拖到机器人上方时自动吸附为子件
        </div>
      </div>
    </div>
  );
}

function CustomAttrsTab({ draft, patch }: { draft: CustomBlock; patch: PatchFn }) {
  const list = draft.userAttrs;
  const update = (i: number, patchAttr: Partial<UserAttr>) => {
    const next = list.map((a, idx) => (idx === i ? { ...a, ...patchAttr } : a));
    patch("userAttrs", next);
  };
  const remove = (i: number) => patch("userAttrs", list.filter((_, idx) => idx !== i));
  const add = () =>
    patch("userAttrs", [
      ...list,
      { key: `attr_${list.length + 1}`, label: "", unit: "", type: "text", value: "" },
    ]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          自由扩展属性（如：能耗等级、安装日期、负载、节拍预算…），将随图块导入导出。
        </div>
        <button
          onClick={add}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50"
        >
          <Plus size={12} /> 新增
        </button>
      </div>

      {list.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 py-6 text-center text-[11px] text-slate-400">
          暂无自定义属性
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left font-medium">Key</th>
                <th className="px-2 py-1 text-left font-medium">显示名</th>
                <th className="px-2 py-1 text-left font-medium">类型</th>
                <th className="px-2 py-1 text-left font-medium">值</th>
                <th className="px-2 py-1 text-left font-medium">单位</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {list.map((a, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-1 py-1">
                    <input
                      className={inputCls + " w-full"}
                      value={a.key}
                      onChange={(e) => update(i, { key: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className={inputCls + " w-full"}
                      value={a.label}
                      onChange={(e) => update(i, { label: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <select
                      className={inputCls + " w-full"}
                      value={a.type}
                      onChange={(e) => update(i, { type: e.target.value as UserAttr["type"] })}
                    >
                      <option value="text">text</option>
                      <option value="number">number</option>
                      <option value="bool">bool</option>
                      <option value="enum">enum</option>
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    {a.type === "bool" ? (
                      <input
                        type="checkbox"
                        checked={!!a.value}
                        onChange={(e) => update(i, { value: e.target.checked })}
                      />
                    ) : a.type === "number" ? (
                      <input
                        type="number"
                        className={inputCls + " w-full"}
                        value={typeof a.value === "number" ? a.value : ""}
                        onChange={(e) =>
                          update(i, { value: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    ) : (
                      <input
                        className={inputCls + " w-full"}
                        value={a.value == null ? "" : String(a.value)}
                        onChange={(e) => update(i, { value: e.target.value })}
                      />
                    )}
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className={inputCls + " w-full"}
                      value={a.unit}
                      onChange={(e) => update(i, { unit: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 text-right">
                    <button
                      onClick={() => remove(i)}
                      className="rounded p-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ========== 瘦身/LOD Tab ========== */

const PRESET_LABELS: Record<SlimPreset, string> = {
  light: "轻度",
  medium: "中度",
  heavy: "重度",
  silhouette: "仅轮廓",
};

const PRESET_HINTS: Record<SlimPreset, string> = {
  light: "去文字 + 极小线段（< 0.2% 对角线）",
  medium: "去文字 + 小线段/小圆 + RDP 简化（~1%）",
  heavy: "去文字/圆/弧 + 较大阈值简化（~3%）",
  silhouette: "整块替换为外包矩形（最快）",
};

function SlimTab({ blockId }: { blockId: string }) {
  // 直接从 store 取最新（不走 draft，瘦身是即时操作而非保存才生效）
  const block = useProjectStore((s) => s.project.customBlocks.find((b) => b.id === blockId));
  const slimPreset = useProjectStore((s) => s.slimCustomBlockPreset);
  const slimCustom = useProjectStore((s) => s.slimCustomBlock);
  const restore = useProjectStore((s) => s.restoreCustomBlock);

  // 自定义参数本地状态
  const [dropLayers, setDropLayers] = useState<Set<string>>(new Set());
  const [dropKinds, setDropKinds] = useState<Set<string>>(new Set());
  const [minSeg, setMinSeg] = useState(0);
  const [minR, setMinR] = useState(0);
  const [eps, setEps] = useState(0);
  const [showEraser, setShowEraser] = useState(false);

  if (!block) return null;

  const stats = statEntities(block.entities);
  const origCount = block.originalEntities?.length ?? null;

  const applyPreset = (p: SlimPreset) => {
    const r = slimPreset(blockId, p);
    if (r) alert(`✅ ${PRESET_LABELS[p]}：${r.before} → ${r.after} (减少 ${r.before - r.after})`);
  };

  const applyCustom = () => {
    const r = slimCustom(blockId, {
      dropLayers: Array.from(dropLayers),
      dropKinds: Array.from(dropKinds) as never,
      minSegmentLen: minSeg,
      minRadius: minR,
      rdpEpsilon: eps,
      replaceWithBBox: false,
    });
    if (r) alert(`✅ 自定义瘦身：${r.before} → ${r.after} (减少 ${r.before - r.after})`);
  };

  const onRestore = () => {
    if (restore(blockId)) alert("✅ 已还原到瘦身前");
    else alert("当前图块未做过瘦身");
  };

  const toggleLayer = (l: string) => {
    setDropLayers((s) => {
      const n = new Set(s);
      n.has(l) ? n.delete(l) : n.add(l);
      return n;
    });
  };
  const toggleKind = (k: string) => {
    setDropKinds((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  };

  return (
    <div className="space-y-4">
      {/* 概览 */}
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px]">
        <div className="flex items-center gap-3">
          <span>当前实体数 <b className="text-sky-700">{stats.total}</b></span>
          {origCount !== null && (
            <span className="text-slate-500">
              原始 <b>{origCount}</b> · 已减 <b className="text-emerald-600">
                {origCount - stats.total} ({((1 - stats.total / Math.max(origCount, 1)) * 100).toFixed(0)}%)
              </b>
            </span>
          )}
          <span className="text-slate-400">|</span>
          {(["line", "polyline", "arc", "circle", "text"] as const).map((k) => (
            <span key={k} className="text-slate-500">
              {k}: <b>{stats.byKind[k]}</b>
            </span>
          ))}
        </div>
        {block.slim.lastAt && (
          <div className="mt-1 text-[10px] text-slate-400">
            上次瘦身：{block.slim.level} · {new Date(block.slim.lastAt).toLocaleString()}
          </div>
        )}
      </div>

      {/* 交互式擦除入口 */}
      <button
        onClick={() => setShowEraser(true)}
        className="flex w-full items-center justify-between rounded border border-sky-300 bg-gradient-to-r from-sky-50 to-indigo-50 p-3 text-left hover:border-sky-500 hover:from-sky-100"
      >
        <div className="flex items-center gap-2">
          <Eraser size={18} className="text-sky-600" />
          <div>
            <div className="text-xs font-semibold text-slate-800">打开擦除画布（推荐）</div>
            <div className="text-[10px] text-slate-500">
              可视化橡皮擦 · 框选擦除 · 框选自动瘦身（区域 LOD），支持撤销/重置
            </div>
          </div>
        </div>
        <span className="text-sky-600">→</span>
      </button>

      {/* 自动预设 */}
      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">自动瘦身（一键预设，全局）</div>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(PRESET_LABELS) as SlimPreset[]).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className="flex flex-col items-start gap-0.5 rounded border border-slate-300 bg-white p-2 text-left hover:border-sky-400 hover:bg-sky-50"
            >
              <span className="flex items-center gap-1 text-xs font-semibold text-slate-700">
                <Zap size={12} className="text-amber-500" />
                {PRESET_LABELS[p]}
              </span>
              <span className="text-[10px] text-slate-500">{PRESET_HINTS[p]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 自定义 */}
      <div className="rounded border border-slate-200 p-3">
        <div className="mb-2 text-[11px] font-semibold text-slate-600">自定义瘦身</div>

        <div className="mb-2">
          <div className="mb-1 text-[11px] text-slate-500">按图层丢弃（点击切换）</div>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {stats.byLayer.map((l) => {
              const on = dropLayers.has(l.layer);
              return (
                <button
                  key={l.layer}
                  onClick={() => toggleLayer(l.layer)}
                  className={
                    "rounded border px-1.5 py-0.5 text-[10px] " +
                    (on
                      ? "border-rose-400 bg-rose-50 text-rose-700 line-through"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")
                  }
                  title={`包含 ${l.count} 个实体`}
                >
                  {l.layer} <span className="text-slate-400">({l.count})</span>
                </button>
              );
            })}
            {stats.byLayer.length === 0 && (
              <span className="text-[10px] text-slate-400">无图层信息</span>
            )}
          </div>
        </div>

        <div className="mb-2">
          <div className="mb-1 text-[11px] text-slate-500">按类型丢弃</div>
          <div className="flex flex-wrap gap-1">
            {(["line", "polyline", "arc", "circle", "text"] as const).map((k) => {
              const on = dropKinds.has(k);
              return (
                <button
                  key={k}
                  onClick={() => toggleKind(k)}
                  className={
                    "rounded border px-1.5 py-0.5 text-[10px] " +
                    (on
                      ? "border-rose-400 bg-rose-50 text-rose-700 line-through"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")
                  }
                >
                  {k} ({stats.byKind[k]})
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Field label="最小线段长度 (mm)" hint="低于则丢">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={minSeg}
              onChange={(e) => setMinSeg(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="最小半径 (mm)" hint="圆/弧低于则丢">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={minR}
              onChange={(e) => setMinR(Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="RDP 阈值 (mm)" hint="折线简化，0=关">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={eps}
              onChange={(e) => setEps(Number(e.target.value) || 0)}
            />
          </Field>
        </div>

        <div className="mt-2 flex justify-end">
          <button
            onClick={applyCustom}
            className="flex items-center gap-1 rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700"
          >
            <Zap size={12} /> 应用自定义瘦身
          </button>
        </div>
      </div>

      {/* 还原 */}
      <div className="flex items-center justify-between rounded border border-slate-200 bg-amber-50 p-2 text-[11px]">
        <span className="text-amber-800">
          所有瘦身都基于<b>原始实体</b>重算，可随时还原
          {origCount === null && "（首次瘦身后才有还原数据）"}
        </span>
        <button
          onClick={onRestore}
          disabled={origCount === null}
          className="flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-1 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          <RotateCcw size={12} /> 还原
        </button>
      </div>

      {showEraser && (
        <BlockEraserCanvas blockId={blockId} onClose={() => setShowEraser(false)} />
      )}
    </div>
  );
}
