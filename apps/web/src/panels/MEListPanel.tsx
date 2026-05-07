/**
 * M+E 清单：画布的另一个视图
 *  - 选中行 ↔ 选中画布对象（双向）
 *  - 编辑名称/单价 → 直接 mutate Equipment → 画布同步
 *  - 汇总：设备数、总投资估算
 */
import { useProjectStore } from "@/store/projectStore";

export function MEListPanel() {
  const equipment = useProjectStore((s) => s.project.equipment);
  const items = useProjectStore((s) => s.project.canvasItems);
  const selectedItemId = useProjectStore((s) => s.selectedItemId);
  const selectItem = useProjectStore((s) => s.selectItem);
  const updateEquipment = useProjectStore((s) => s.updateEquipment);
  const deleteCanvasItem = useProjectStore((s) => s.deleteCanvasItem);

  // equipment id -> canvasItem
  const eqToItem = new Map<string, string>();
  for (const it of items) if (it.kind === "equipment" && it.refId) eqToItem.set(it.refId, it.id);

  const totalCost = equipment.reduce((s, e) => s + (e.unitCost || 0), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700">M+E 清单</span>
        <span className="text-xs text-slate-500">
          {equipment.length} 项 · 估算 <b className="text-slate-800">{totalCost.toFixed(1)}</b> 万
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">名称</th>
              <th className="px-2 py-1.5">类别</th>
              <th className="px-2 py-1.5">型号</th>
              <th className="px-2 py-1.5 text-right">W×H (mm)</th>
              <th className="px-2 py-1.5 text-right">单价(万)</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {equipment.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  从左侧设备库拖入画布开始
                </td>
              </tr>
            )}
            {equipment.map((e, idx) => {
              const itemId = eqToItem.get(e.id);
              const selected = itemId === selectedItemId;
              return (
                <tr
                  key={e.id}
                  className={
                    "border-b border-slate-100 cursor-pointer hover:bg-sky-50 " +
                    (selected ? "bg-sky-100" : "")
                  }
                  onClick={() => itemId && selectItem(itemId)}
                >
                  <td className="px-2 py-1 text-slate-400">{idx + 1}</td>
                  <td className="px-2 py-1">
                    <input
                      className="w-full bg-transparent outline-none"
                      value={e.name}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => updateEquipment(e.id, { name: ev.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1 text-slate-600">{e.category}</td>
                  <td className="px-2 py-1 text-slate-500">{e.modelId ?? "-"}</td>
                  <td className="px-2 py-1 text-right text-slate-600">
                    {e.footprint.w}×{e.footprint.h}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input
                      type="number"
                      className="w-16 bg-transparent text-right outline-none"
                      value={e.unitCost}
                      onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) =>
                        updateEquipment(e.id, { unitCost: parseFloat(ev.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      className="text-rose-500 hover:underline"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (itemId) deleteCanvasItem(itemId);
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
