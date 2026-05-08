/**
 * CT 表（M1 简版）：工位 + 工序 + 节拍 + UPH
 *  - 集成动线行走工时 (walkSec)：工序总 CT = 工时 + 行走（含已挂钩动线）
 */
import { useMemo } from "react";
import { useProjectStore } from "@/store/projectStore";

export function CTPanel() {
  const stations = useProjectStore((s) => s.project.stations);
  const operations = useProjectStore((s) => s.project.operations);
  const motionPaths = useProjectStore((s) => s.project.motionPaths);
  const addStation = useProjectStore((s) => s.addStation);
  const updateStation = useProjectStore((s) => s.updateStation);
  const deleteStation = useProjectStore((s) => s.deleteStation);
  const addOperation = useProjectStore((s) => s.addOperation);
  const updateOperation = useProjectStore((s) => s.updateOperation);
  const deleteOperation = useProjectStore((s) => s.deleteOperation);
  const selectPath = useProjectStore((s) => s.selectPath);

  /** opId -> 行走秒数（来自挂钩动线汇总） */
  const walkByOp = useMemo(() => {
    const m = new Map<string, number>();
    for (const mp of motionPaths) {
      if (!mp.operationId || !mp.derived) continue;
      m.set(mp.operationId, (m.get(mp.operationId) ?? 0) + mp.derived.totalSec);
    }
    return m;
  }, [motionPaths]);

  /** stId -> 行走秒数（来自挂钩动线汇总） */
  const walkByStation = useMemo(() => {
    const m = new Map<string, number>();
    for (const mp of motionPaths) {
      if (!mp.stationId || !mp.derived) continue;
      m.set(mp.stationId, (m.get(mp.stationId) ?? 0) + mp.derived.totalSec);
    }
    return m;
  }, [motionPaths]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">CT 表 / 节拍</span>
        <button
          className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
          onClick={() => addStation()}
        >
          + 新增工位
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3">
        {stations.length === 0 && (
          <div className="rounded border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
            暂无工位，点击右上角"新增工位"
          </div>
        )}
        {stations.map((st) => {
          const ops = operations.filter((o) => o.stationId === st.id);
          // 工位 = 工序操作时间合计 + 工序行走 + 直接挂工位的行走
          const opsBaseSec = ops.reduce((s, o) => s + (o.cycleTimeSec || 0), 0);
          const opsWalkSec = ops.reduce((s, o) => s + (walkByOp.get(o.id) ?? 0), 0);
          const stationDirectWalk = walkByStation.get(st.id) ?? 0;
          const total = opsBaseSec + opsWalkSec + stationDirectWalk;
          const target = st.targetTaktSec ?? 60;
          const overload = total > target;
          const uph = total > 0 ? Math.floor(3600 / total) : 0;
          const stationPaths = motionPaths.filter((mp) => mp.stationId === st.id);
          return (
            <div key={st.id} className="rounded border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
                <input
                  className="flex-1 bg-transparent text-sm font-semibold outline-none"
                  value={st.name}
                  onChange={(e) => updateStation(st.id, { name: e.target.value })}
                />
                <label className="text-xs text-slate-500">目标节拍(s)</label>
                <input
                  type="number"
                  className="w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
                  value={target}
                  onChange={(e) =>
                    updateStation(st.id, { targetTaktSec: parseFloat(e.target.value) || 0 })
                  }
                />
                <span
                  className={
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                    (overload ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")
                  }
                >
                  累计 {total.toFixed(1)}s · UPH {uph}
                </span>
                <button
                  className="text-xs text-slate-500 hover:text-rose-500"
                  onClick={() => deleteStation(st.id)}
                >
                  删除
                </button>
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1 w-8">#</th>
                    <th className="px-2 py-1">工序</th>
                    <th className="px-2 py-1 text-right w-16">操作 (s)</th>
                    <th className="px-2 py-1 text-right w-16">行走 (s)</th>
                    <th className="px-2 py-1 text-right w-16">合计 (s)</th>
                    <th className="px-2 py-1 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((op, idx) => {
                    const walk = walkByOp.get(op.id) ?? 0;
                    const sum = (op.cycleTimeSec || 0) + walk;
                    return (
                      <tr key={op.id} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-400">{idx + 1}</td>
                        <td className="px-2 py-1">
                          <input
                            className="w-full bg-transparent outline-none"
                            value={op.name}
                            onChange={(e) => updateOperation(op.id, { name: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <input
                            type="number"
                            className="w-12 bg-transparent text-right outline-none"
                            value={op.cycleTimeSec}
                            onChange={(e) =>
                              updateOperation(op.id, {
                                cycleTimeSec: parseFloat(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td
                          className={
                            "px-2 py-1 text-right " +
                            (walk > 0 ? "text-sky-700" : "text-slate-300")
                          }
                          title={
                            walk > 0
                              ? "来自挂钩到此工序的动线工时（点击查看）"
                              : "未挂钩动线"
                          }
                        >
                          {walk > 0 ? walk.toFixed(1) : "—"}
                        </td>
                        <td className="px-2 py-1 text-right font-semibold text-slate-700">
                          {sum.toFixed(1)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            className="text-rose-500 hover:underline"
                            onClick={() => deleteOperation(op.id)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td colSpan={6} className="px-2 py-1">
                      <button
                        className="text-xs text-sky-600 hover:underline"
                        onClick={() => addOperation(st.id)}
                      >
                        + 添加工序
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* 直接挂工位的动线（不在具体工序上） */}
              {(stationPaths.length > 0 || stationDirectWalk > 0) && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-2 py-1.5 text-[11px]">
                  <div className="text-slate-500">
                    工位级动线（{stationPaths.length}）：
                    {stationPaths.map((mp) => (
                      <button
                        key={mp.id}
                        onClick={() => selectPath(mp.id)}
                        className="ml-1 rounded bg-white px-1.5 py-0.5 text-slate-600 ring-1 ring-slate-200 hover:bg-sky-50 hover:text-sky-700"
                      >
                        {mp.name} {mp.derived ? `${mp.derived.totalSec.toFixed(1)}s` : ""}
                      </button>
                    ))}
                    {stationDirectWalk > 0 && (
                      <span className="ml-2 text-sky-700">
                        合计 +{stationDirectWalk.toFixed(1)}s
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
