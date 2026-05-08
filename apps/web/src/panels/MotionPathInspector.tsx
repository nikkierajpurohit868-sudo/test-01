/**
 * 动线属性面板：选中动线时显示
 *  - 三模式切换：UAS / MTM-1 / 自定义
 *  - 端点动作多选（TMU 标定）
 *  - 挂钩 Operation / Station
 *  - 计算结果只读表格
 */
import { useMemo } from "react";
import { Trash2, Eye, EyeOff } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import type { MotionStandardMode, MotionType, MotionActionId } from "@ilp/schema";
import {
  MOTION_TYPE_LABEL,
  MOTION_TYPE_COLOR,
  ACTION_TMU,
  ACTION_ORDER,
  SPEED_BY_TYPE,
  TMU_PER_STEP_BY_TYPE,
} from "@/lib/motionStandards";

export function MotionPathInspector() {
  const pathId = useProjectStore((s) => s.selectedPathId);
  const path = useProjectStore((s) =>
    pathId ? s.project.motionPaths.find((p) => p.id === pathId) : null
  );
  const operations = useProjectStore((s) => s.project.operations);
  const stations = useProjectStore((s) => s.project.stations);
  const update = useProjectStore((s) => s.updateMotionPath);
  const del = useProjectStore((s) => s.deleteMotionPath);
  const selectPath = useProjectStore((s) => s.selectPath);
  const motionDefaults = useProjectStore((s) => s.project.meta.motionDefaults);

  if (!path) return null;

  const allowance = path.customAllowance ?? motionDefaults.pfdAllowance;
  const der = path.derived;

  return (
    <div className="flex h-full flex-col text-xs">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">动线属性</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => update(path.id, { visible: !path.visible })}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title={path.visible ? "隐藏" : "显示"}
          >
            {path.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={() => {
              if (confirm(`删除「${path.name}」？`)) {
                del(path.id);
                selectPath(null);
              }
            }}
            className="rounded p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* 名称 + 颜色 */}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            className="rounded border border-slate-300 px-2 py-1"
            value={path.name}
            onChange={(e) => update(path.id, { name: e.target.value })}
          />
          <input
            type="color"
            className="h-7 w-8 cursor-pointer rounded border border-slate-300"
            value={path.color}
            onChange={(e) => update(path.id, { color: e.target.value })}
          />
        </div>

        {/* 标准模式 Tab */}
        <div>
          <div className="mb-1 text-[11px] font-semibold text-slate-600">标准工时模式</div>
          <div className="grid grid-cols-3 overflow-hidden rounded border border-slate-300">
            {(["uas", "mtm1", "custom"] as MotionStandardMode[]).map((m) => (
              <button
                key={m}
                onClick={() => update(path.id, { standardMode: m })}
                className={
                  "py-1 text-[11px] " +
                  (path.standardMode === m
                    ? "bg-sky-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50")
                }
              >
                {m === "uas" ? "UAS 预设" : m === "mtm1" ? "MTM-1 TMU" : "自定义"}
              </button>
            ))}
          </div>
        </div>

        {/* 模式相关参数 */}
        {(path.standardMode === "uas" || path.standardMode === "mtm1") && (
          <div>
            <Label>动线类型</Label>
            <select
              className={inputCls}
              value={path.motionType}
              onChange={(e) => {
                const mt = e.target.value as MotionType;
                update(path.id, {
                  motionType: mt,
                  color: MOTION_TYPE_COLOR[mt] ?? path.color,
                });
              }}
            >
              {(Object.keys(MOTION_TYPE_LABEL) as MotionType[])
                .filter((t) => t !== "custom")
                .map((t) => (
                  <option key={t} value={t}>
                    {MOTION_TYPE_LABEL[t]}（{SPEED_BY_TYPE[t].toFixed(2)} m/s
                    {path.standardMode === "mtm1"
                      ? ` · ${TMU_PER_STEP_BY_TYPE[t]} TMU/步`
                      : ""}
                    ）
                  </option>
                ))}
            </select>
          </div>
        )}

        {path.standardMode === "custom" && (
          <div>
            <Label>自定义速度 (m/s)</Label>
            <input
              type="number"
              step={0.05}
              min={0.1}
              className={inputCls}
              value={path.customSpeed ?? 1.0}
              onChange={(e) =>
                update(path.id, { customSpeed: Number(e.target.value) || 0.1 })
              }
            />
          </div>
        )}

        {path.standardMode === "mtm1" && (
          <div className="rounded bg-slate-50 p-2 text-[10px] text-slate-500">
            步长（项目级）：{motionDefaults.stepLengthMm} mm；可在项目设置中调整
          </div>
        )}

        {/* PF&D */}
        <div>
          <Label>
            PF&D 宽放 ({((path.customAllowance ?? motionDefaults.pfdAllowance) * 100).toFixed(0)}%)
          </Label>
          <input
            type="range"
            min={0}
            max={50}
            step={1}
            className="w-full"
            value={Math.round(allowance * 100)}
            onChange={(e) =>
              update(path.id, { customAllowance: Number(e.target.value) / 100 })
            }
          />
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>0%（生时间）</span>
            <button
              onClick={() => update(path.id, { customAllowance: undefined })}
              className="text-sky-600 hover:underline"
              disabled={path.customAllowance === undefined}
            >
              使用项目默认（{(motionDefaults.pfdAllowance * 100).toFixed(0)}%）
            </button>
            <span>50%</span>
          </div>
        </div>

        {/* 端点 / 中段动作 */}
        <ActionsEditor
          actions={path.endpointActions}
          waypointCount={path.waypoints.length}
          onChange={(arr) => update(path.id, { endpointActions: arr })}
        />

        {/* 挂钩 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>挂钩工序</Label>
            <select
              className={inputCls}
              value={path.operationId ?? ""}
              onChange={(e) =>
                update(path.id, { operationId: e.target.value || undefined })
              }
            >
              <option value="">— 未挂钩 —</option>
              {operations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>挂钩工位</Label>
            <select
              className={inputCls}
              value={path.stationId ?? ""}
              onChange={(e) =>
                update(path.id, { stationId: e.target.value || undefined })
              }
            >
              <option value="">— 未挂钩 —</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 结果 */}
        <div className="rounded border border-slate-200 bg-gradient-to-br from-sky-50 to-indigo-50 p-2">
          <div className="mb-1 text-[11px] font-semibold text-slate-700">计算结果</div>
          {der ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="长度" value={`${(der.lengthMm / 1000).toFixed(2)} m`} />
                <Stat label="行走" value={`${der.walkSec.toFixed(2)} s`} />
                <Stat label="动作" value={`${der.actionsSec.toFixed(2)} s`} />
              </div>
              <div className="mt-1.5 rounded bg-sky-600 px-2 py-1 text-center text-sm font-bold text-white">
                总计 {der.totalSec.toFixed(2)} s
                {der.tmu !== undefined && (
                  <span className="ml-2 text-[10px] font-normal text-sky-100">
                    ({der.tmu.toFixed(0)} TMU{der.steps !== undefined ? ` · ${der.steps} 步` : ""})
                  </span>
                )}
              </div>
              <table className="mt-2 w-full text-[10px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="px-1 py-0.5 text-left font-medium">明细</th>
                    <th className="px-1 py-0.5 text-right font-medium">TMU</th>
                    <th className="px-1 py-0.5 text-right font-medium">秒</th>
                  </tr>
                </thead>
                <tbody>
                  {der.breakdown.map((b, i) => (
                    <tr key={i} className="border-t border-slate-200/60">
                      <td className="px-1 py-0.5">{b.label}</td>
                      <td className="px-1 py-0.5 text-right">
                        {b.tmu !== undefined ? b.tmu.toFixed(1) : "—"}
                      </td>
                      <td className="px-1 py-0.5 text-right">{b.sec.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="text-slate-400">无计算结果</div>
          )}
        </div>

        <div className="text-[10px] text-slate-400">
          共 {path.waypoints.length} 个路径点；选中后端点可拖拽，中段白点可插入新点，端点双击删除中间点
        </div>
      </div>
    </div>
  );
}

function ActionsEditor({
  actions,
  waypointCount,
  onChange,
}: {
  actions: { at: "start" | "end" | number; actionId: MotionActionId }[];
  waypointCount: number;
  onChange: (arr: { at: "start" | "end" | number; actionId: MotionActionId }[]) => void;
}) {
  const totalTmu = useMemo(
    () => actions.reduce((s, a) => s + (ACTION_TMU[a.actionId]?.tmu ?? 0), 0),
    [actions]
  );

  const add = () =>
    onChange([...actions, { at: "start", actionId: "pickup_small" }]);
  const remove = (i: number) => onChange(actions.filter((_, j) => j !== i));
  const update = (i: number, patch: Partial<(typeof actions)[number]>) => {
    const next = actions.slice();
    next[i] = { ...next[i]!, ...patch };
    onChange(next);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-slate-600">
          端点 / 中段动作
          {actions.length > 0 && (
            <span className="ml-1 text-[10px] font-normal text-slate-400">
              ({totalTmu.toFixed(1)} TMU)
            </span>
          )}
        </span>
        <button
          onClick={add}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] hover:bg-slate-50"
        >
          + 添加
        </button>
      </div>
      {actions.length === 0 && (
        <div className="text-[10px] text-slate-400">无</div>
      )}
      {actions.map((a, i) => (
        <div key={i} className="mb-1 grid grid-cols-[auto_1fr_auto] items-center gap-1">
          <select
            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px]"
            value={typeof a.at === "number" ? `wp_${a.at}` : a.at}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "start" || v === "end") update(i, { at: v });
              else update(i, { at: parseInt(v.slice(3), 10) });
            }}
          >
            <option value="start">起点</option>
            <option value="end">终点</option>
            {Array.from({ length: Math.max(0, waypointCount - 2) }, (_, k) => (
              <option key={k} value={`wp_${k + 1}`}>
                第{k + 2}点
              </option>
            ))}
          </select>
          <select
            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px]"
            value={a.actionId}
            onChange={(e) =>
              update(i, { actionId: e.target.value as MotionActionId })
            }
          >
            {ACTION_ORDER.map((id) => (
              <option key={id} value={id}>
                {ACTION_TMU[id].label}（{ACTION_TMU[id].tmu} TMU）
              </option>
            ))}
          </select>
          <button
            onClick={() => remove(i)}
            className="rounded p-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

const inputCls = "w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs";
function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-0.5 text-[11px] text-slate-500">{children}</div>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-slate-400">
        {label}
      </div>
      <div className="text-xs font-semibold text-slate-800">{value}</div>
    </div>
  );
}
