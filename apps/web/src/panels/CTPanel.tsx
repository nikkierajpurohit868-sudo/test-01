/**
 * CT 表（M1 简版）：工位 + 工序 + 节拍 + UPH
 *  TODO M2: 工序 ↔ 制造要素 / 设备 关联，标准 MTM 拆解
 */
import { useProjectStore } from "@/store/projectStore";

export function CTPanel() {
  const stations = useProjectStore((s) => s.project.stations);
  const operations = useProjectStore((s) => s.project.operations);
  const addStation = useProjectStore((s) => s.addStation);
  const updateStation = useProjectStore((s) => s.updateStation);
  const deleteStation = useProjectStore((s) => s.deleteStation);
  const addOperation = useProjectStore((s) => s.addOperation);
  const updateOperation = useProjectStore((s) => s.updateOperation);
  const deleteOperation = useProjectStore((s) => s.deleteOperation);

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
          const total = ops.reduce((s, o) => s + (o.cycleTimeSec || 0), 0);
          const target = st.targetTaktSec ?? 60;
          const overload = total > target;
          const uph = total > 0 ? Math.floor(3600 / total) : 0;
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
                    <th className="px-2 py-1 text-right w-20">CT (s)</th>
                    <th className="px-2 py-1 w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map((op, idx) => (
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
                          className="w-16 bg-transparent text-right outline-none"
                          value={op.cycleTimeSec}
                          onChange={(e) =>
                            updateOperation(op.id, {
                              cycleTimeSec: parseFloat(e.target.value) || 0,
                            })
                          }
                        />
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
                  ))}
                  <tr>
                    <td colSpan={4} className="px-2 py-1">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
