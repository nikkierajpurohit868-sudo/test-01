/**
 * 批量瘦身对话框：选择预设 + 实体数阈值，对所有图块一键应用
 */
import { useMemo, useState } from "react";
import { X, Zap } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import type { SlimPreset } from "@/lib/slimBlock";

const PRESET_LABELS: Record<SlimPreset, string> = {
  light: "轻度",
  medium: "中度",
  heavy: "重度",
  silhouette: "仅轮廓",
};

export function BatchSlimDialog({ onClose }: { onClose: () => void }) {
  const blocks = useProjectStore((s) => s.project.customBlocks);
  const slimAll = useProjectStore((s) => s.slimAllCustomBlocks);

  const [preset, setPreset] = useState<SlimPreset>("medium");
  const [threshold, setThreshold] = useState(200);

  /** 命中预览 */
  const targets = useMemo(
    () =>
      blocks.filter(
        (b) => (b.originalEntities?.length ?? b.entities.length) >= threshold
      ),
    [blocks, threshold]
  );
  const totalEntities = targets.reduce(
    (s, b) => s + (b.originalEntities?.length ?? b.entities.length),
    0
  );

  const apply = () => {
    if (targets.length === 0) {
      alert("没有满足阈值的图块");
      return;
    }
    const ok = confirm(
      `将对 ${targets.length} 个图块应用「${PRESET_LABELS[preset]}」预设。\n` +
        `(可在每个图块的"瘦身/LOD"页签中单独还原)\n\n继续？`
    );
    if (!ok) return;
    const r = slimAll(preset, threshold);
    alert(
      `✅ 已处理 ${r.affected} 个图块\n实体总数 ${r.before} → ${r.after}\n减少 ${r.before - r.after} (${(((r.before - r.after) / Math.max(r.before, 1)) * 100).toFixed(0)}%)`
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Zap size={14} className="text-amber-500" /> 批量瘦身图块
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4 text-xs">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-slate-600">瘦身强度</div>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(PRESET_LABELS) as SlimPreset[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={
                    "rounded border p-2 text-xs " +
                    (preset === p
                      ? "border-sky-500 bg-sky-50 font-semibold text-sky-700"
                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50")
                  }
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
              仅处理实体数 ≥
              <input
                type="number"
                min={0}
                step={50}
                className="w-20 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value) || 0)}
              />
              的图块
            </label>
            <div className="mt-1 text-[10px] text-slate-400">
              建议保留小图块（&lt; 100 实体）的细节，仅瘦身大图块。
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-600">
              将影响 {targets.length} / {blocks.length} 个图块（合计 {totalEntities} 实体）
            </div>
            {targets.length === 0 ? (
              <div className="text-[11px] text-slate-400">无命中</div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-1 py-0.5 text-left font-medium">名称</th>
                      <th className="px-1 py-0.5 text-right font-medium">原始</th>
                      <th className="px-1 py-0.5 text-right font-medium">当前</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((b) => {
                      const orig = b.originalEntities?.length ?? b.entities.length;
                      return (
                        <tr key={b.id} className="border-t border-slate-100">
                          <td className="truncate px-1 py-0.5">{b.name}</td>
                          <td className="px-1 py-0.5 text-right">{orig}</td>
                          <td className="px-1 py-0.5 text-right">{b.entities.length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5">
          <button onClick={onClose} className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={apply}
            disabled={targets.length === 0}
            className="flex items-center gap-1 rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-700 disabled:opacity-50"
          >
            <Zap size={12} /> 应用
          </button>
        </div>
      </div>
    </div>
  );
}
