import { EQUIPMENT_LIBRARY, type EquipmentTemplate } from "@/lib/equipmentLibrary";

export function EquipmentLibraryPanel() {
  const onDragStart = (e: React.DragEvent, tpl: EquipmentTemplate) => {
    e.dataTransfer.setData("application/x-ilp-equipment", tpl.modelId);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
        设备库
      </div>
      <div className="flex-1 space-y-1 overflow-auto p-2">
        {EQUIPMENT_LIBRARY.map((tpl) => (
          <div
            key={tpl.modelId}
            draggable
            onDragStart={(e) => onDragStart(e, tpl)}
            className="cursor-grab rounded border border-slate-200 bg-white px-2 py-1.5 text-xs hover:border-slate-400 hover:shadow-sm active:cursor-grabbing"
          >
            <div className="flex items-center gap-2">
              <div
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: tpl.color }}
              />
              <div className="flex-1 truncate font-medium text-slate-800">{tpl.name}</div>
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
              <span>
                {tpl.footprint.w}×{tpl.footprint.h}mm
              </span>
              <span>{tpl.unitCost > 0 ? `${tpl.unitCost}万` : "—"}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 px-3 py-2 text-[10px] text-slate-500">
        拖入画布即生成 M+E 行
      </div>
    </div>
  );
}
