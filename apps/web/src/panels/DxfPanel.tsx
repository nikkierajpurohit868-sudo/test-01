import { Eye, EyeOff, Trash2 } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";

export function DxfPanel() {
  const dxfs = useProjectStore((s) => s.project.dxfBackgrounds);
  const updateDxf = useProjectStore((s) => s.updateDxfBackground);
  const deleteDxf = useProjectStore((s) => s.deleteDxfBackground);

  if (dxfs.length === 0) {
    return (
      <div className="border-t border-slate-200 p-2 text-[10px] text-slate-400">
        无 DXF 底图（点工具栏"导入 DXF"）
      </div>
    );
  }

  return (
    <div className="border-t border-slate-200">
      <div className="px-3 py-1.5 text-xs font-semibold text-slate-700">DXF 底图</div>
      <div className="space-y-1 px-2 pb-2">
        {dxfs.map((b) => (
          <div
            key={b.id}
            className="flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
          >
            <button
              onClick={() => updateDxf(b.id, { visible: !b.visible })}
              className="text-slate-500 hover:text-slate-800"
              title={b.visible ? "隐藏" : "显示"}
            >
              {b.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <span className="flex-1 truncate" title={b.name}>
              {b.name}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={b.opacity}
              className="w-12"
              onChange={(e) => updateDxf(b.id, { opacity: parseFloat(e.target.value) })}
              title={`不透明度 ${(b.opacity * 100).toFixed(0)}%`}
            />
            <button
              onClick={() => deleteDxf(b.id)}
              className="text-slate-400 hover:text-rose-500"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="px-1 text-[10px] text-slate-400">
          {dxfs.reduce((s, b) => s + b.entities.length, 0)} 个实体
        </div>
      </div>
    </div>
  );
}
