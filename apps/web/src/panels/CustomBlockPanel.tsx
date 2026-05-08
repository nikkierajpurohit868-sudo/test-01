/**
 * 我的图块面板：显示所有自定义图块，支持拖到画布
 */
import { useMemo, useState } from "react";
import { Trash2, Search, Pencil } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import type { CustomBlock, CustomBlockCategory } from "@ilp/schema";
import { BlockDefinitionEditor } from "@/components/BlockDefinitionEditor";

const CATEGORY_LABEL: Record<CustomBlockCategory, string> = {
  robot: "机器人",
  fixture: "夹具",
  conveyor: "输送",
  manual_station: "工位",
  material_buffer: "缓存",
  structural: "建筑",
  other: "其他",
};

export function CustomBlockPanel() {
  const blocks = useProjectStore((s) => s.project.customBlocks);
  const canvasItems = useProjectStore((s) => s.project.canvasItems);
  const deleteBlock = useProjectStore((s) => s.deleteCustomBlock);
  const [filter, setFilter] = useState("");
  const [cat, setCat] = useState<"all" | CustomBlockCategory>("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  /** 每个图块的实例数：refId -> count */
  const instanceCountMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of canvasItems) {
      if (it.kind === "customBlock" && it.refId) {
        m.set(it.refId, (m.get(it.refId) ?? 0) + 1);
      }
    }
    return m;
  }, [canvasItems]);

  const visible = blocks.filter(
    (b) =>
      (cat === "all" || b.category === cat) &&
      (!filter || b.name.toLowerCase().includes(filter.toLowerCase()))
  );

  if (blocks.length === 0) {
    return (
      <div className="border-t border-slate-200 px-3 py-2 text-[10px] text-slate-400">
        无自定义图块（点工具栏"抽取 DXF 图块"导入）
      </div>
    );
  }

  return (
    <div className="flex max-h-[40%] min-h-0 flex-col border-t border-slate-200">
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <span className="text-xs font-semibold text-slate-700">我的图块</span>
        <span className="text-[10px] text-slate-400">({blocks.length})</span>
      </div>
      <div className="flex items-center gap-1 px-2 pb-1">
        <div className="flex flex-1 items-center gap-1 rounded border border-slate-200 bg-white px-1.5">
          <Search size={10} className="text-slate-400" />
          <input
            placeholder="搜索"
            className="flex-1 py-0.5 text-[11px] focus:outline-none"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <select
          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
          value={cat}
          onChange={(e) => setCat(e.target.value as "all" | CustomBlockCategory)}
        >
          <option value="all">全部</option>
          {(Object.keys(CATEGORY_LABEL) as CustomBlockCategory[]).map((k) => (
            <option key={k} value={k}>
              {CATEGORY_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        <div className="grid grid-cols-2 gap-1">
          {visible.map((b) => (
            <BlockCard
              key={b.id}
              block={b}
              instanceCount={instanceCountMap.get(b.id) ?? 0}
              onDelete={() => deleteBlock(b.id)}
              onEdit={() => setEditingId(b.id)}
            />
          ))}
        </div>
        {visible.length === 0 && (
          <div className="py-3 text-center text-[10px] text-slate-400">无匹配项</div>
        )}
      </div>

      {editingId && (
        <BlockDefinitionEditor blockId={editingId} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

function BlockCard({
  block,
  instanceCount,
  onDelete,
  onEdit,
}: {
  block: CustomBlock;
  instanceCount: number;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-ilp-customblock", block.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDoubleClick={onEdit}
      className="group relative cursor-grab rounded border border-slate-200 bg-white p-1 hover:border-sky-400 hover:bg-sky-50"
      title={`${block.name} (${(block.footprint.w / 1000).toFixed(1)}×${(block.footprint.h / 1000).toFixed(1)}m)\n双击编辑定义`}
    >
      <div className="flex h-12 items-center justify-center overflow-hidden rounded bg-slate-50">
        {block.previewDataUrl ? (
          <img src={block.previewDataUrl} alt={block.name} className="max-h-12 max-w-full" />
        ) : (
          <span className="text-[9px] text-slate-300">无图</span>
        )}
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <span className="truncate text-[10px] text-slate-700">{block.name}</span>
        <span
          className="shrink-0 rounded bg-slate-100 px-1 text-[9px] text-slate-500"
          title={`画布实例 ${instanceCount} / 规划 ${block.plannedQty}`}
        >
          {instanceCount}/{block.plannedQty || "—"}
        </span>
      </div>
      <div className="text-[9px] text-slate-400">{CATEGORY_LABEL[block.category]}</div>

      <div className="absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="编辑定义"
          className="rounded p-0.5 text-slate-400 hover:bg-sky-100 hover:text-sky-600"
        >
          <Pencil size={10} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`删除图块 ${block.name}？已放置的实例不会受影响`)) onDelete();
          }}
          title="删除"
          className="rounded p-0.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600"
        >
          <Trash2 size={10} />
        </button>
      </div>
    </div>
  );
}
