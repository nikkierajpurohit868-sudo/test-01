import type { DxfProgress } from "@/dxf/parseDxf";

const PHASE_LABEL: Record<DxfProgress["phase"], string> = {
  read: "1/3 读取文件",
  parse: "2/3 解析 DXF",
  expand: "3/3 展开实体",
  extract: "3/3 抽取图块",
  done: "完成",
};

export function DxfProgressOverlay({ progress }: { progress: DxfProgress | null }) {
  if (!progress) return null;
  const indeterminate = progress.phase === "read" || progress.phase === "parse";
  // expand 阶段没有真实总数（INSERT 会膨胀），用 topLevelTotal 当伪进度参考
  const pct = indeterminate
    ? 0
    : Math.min(
        99,
        progress.topLevelTotal > 0
          ? Math.floor(((progress.processed % progress.topLevelTotal) / progress.topLevelTotal) * 100)
          : 0
      );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="w-[420px] rounded-lg bg-white p-5 shadow-2xl ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">DXF 导入</div>
          <div className="text-xs text-slate-500">{PHASE_LABEL[progress.phase]}</div>
        </div>

        {/* 进度条 */}
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-100">
          {indeterminate ? (
            <div className="h-full w-1/3 animate-[shimmer_1.2s_linear_infinite] rounded-full bg-sky-500" />
          ) : (
            <div
              className="h-full rounded-full bg-sky-500 transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>

        <div className="text-xs text-slate-600">{progress.message}</div>

        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
          <Stat label="顶层实体" value={progress.topLevelTotal.toLocaleString()} />
          <Stat label="已处理" value={progress.processed.toLocaleString()} />
          <Stat label="INSERT 展开" value={progress.insertsExpanded.toLocaleString()} />
        </div>

        <style>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(400%); }
          }
        `}</style>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 px-2 py-1">
      <div className="text-slate-400">{label}</div>
      <div className="font-mono text-slate-700">{value}</div>
    </div>
  );
}
