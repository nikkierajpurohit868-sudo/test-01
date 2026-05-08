/**
 * 图块抽取向导
 *  Step 1: 选 DXF 文件
 *  Step 2: Worker 解析 + 抽取（进度提示）
 *  Step 3: 网格视图，逐项勾选/命名/分类
 *  Step 4: 一键入库
 */
import { useState } from "react";
import { Upload, X, Search } from "lucide-react";
import {
  extractDxfBlocksFromFile,
  type DxfProgress,
  type ExtractedBlock,
} from "@/dxf/parseDxf";
import { renderBlockPreview } from "@/dxf/renderBlockPreview";
import { useProjectStore } from "@/store/projectStore";
import type { CustomBlockCategory } from "@ilp/schema";
import { DxfProgressOverlay } from "@/components/DxfProgressOverlay";

const CATEGORY_OPTS: { value: CustomBlockCategory; label: string }[] = [
  { value: "robot", label: "机器人" },
  { value: "fixture", label: "夹具" },
  { value: "conveyor", label: "输送" },
  { value: "manual_station", label: "人工工位" },
  { value: "material_buffer", label: "物料缓存" },
  { value: "structural", label: "建筑/结构" },
  { value: "other", label: "其他" },
];

interface BlockRow {
  block: ExtractedBlock;
  preview: string;
  selected: boolean;
  name: string;
  category: CustomBlockCategory;
}

export function BlockImportWizard({ onClose }: { onClose: () => void }) {
  const addCustomBlocks = useProjectStore((s) => s.addCustomBlocks);
  const [progress, setProgress] = useState<DxfProgress | null>(null);
  const [rows, setRows] = useState<BlockRow[] | null>(null);
  const [sourceFile, setSourceFile] = useState<string>("");
  const [filter, setFilter] = useState("");

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const sizeMB = f.size / 1024 / 1024;
    if (sizeMB > 50) {
      const ok = confirm(
        `DXF 文件较大 (${sizeMB.toFixed(0)} MB)，抽取过程在 Worker 后台运行。\n继续？`
      );
      if (!ok) {
        e.target.value = "";
        return;
      }
    }
    try {
      const result = await extractDxfBlocksFromFile(f, (p) => setProgress(p));
      setProgress(null);
      setSourceFile(result.sourceFile);
      const newRows: BlockRow[] = result.blocks.map((b) => {
        const preview = renderBlockPreview(b.entities, b.bbox, 128);
        return {
          block: b,
          preview,
          selected: true,
          name: b.name,
          category: guessCategory(b.name),
        };
      });
      setRows(newRows);
    } catch (err) {
      setProgress(null);
      alert(`抽取失败: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
    }
  };

  const setRow = (i: number, patch: Partial<BlockRow>) => {
    setRows((rs) => {
      if (!rs) return rs;
      const next = [...rs];
      next[i] = { ...next[i]!, ...patch };
      return next;
    });
  };

  const toggleAll = (sel: boolean) =>
    setRows((rs) => rs?.map((r) => ({ ...r, selected: sel })) ?? null);

  const onConfirm = () => {
    if (!rows) return;
    const picks = rows.filter((r) => r.selected);
    if (picks.length === 0) {
      alert("未选中任何图块");
      return;
    }
    const blocks = picks.map((r) => {
      const w = Math.max(1, r.block.bbox.maxX - r.block.bbox.minX);
      const h = Math.max(1, r.block.bbox.maxY - r.block.bbox.minY);
      return {
        name: r.name,
        category: r.category,
        entities: r.block.entities,
        bbox: r.block.bbox,
        footprint: { w, h },
        previewDataUrl: r.preview,
        color: "#475569",
        source: { dxfFile: sourceFile, blockName: r.block.name },
        metadata: {},
      };
    });
    addCustomBlocks(blocks);
    alert(`已导入 ${picks.length} 个图块到设备库`);
    onClose();
  };

  const filtered = (rows ?? []).map((r, i) => ({ r, i })).filter(
    ({ r }) => !filter || r.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <DxfProgressOverlay progress={progress} />
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
        <div className="flex h-[85vh] w-[1100px] flex-col rounded-lg bg-white shadow-2xl ring-1 ring-slate-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-800">从 DXF 抽取图块到设备库</div>
              <div className="text-xs text-slate-500">
                {rows
                  ? `共 ${rows.length} 个有效块（来源：${sourceFile}）。勾选并命名后入库。`
                  : "选择历史规划图，自动提取所有 BLOCK 定义"}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          {!rows ? (
            <div className="flex flex-1 items-center justify-center">
              <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 px-12 py-8 hover:border-sky-400 hover:bg-sky-50">
                <Upload size={36} className="text-slate-400" />
                <div className="text-sm text-slate-600">点击选择 .dxf 文件</div>
                <input type="file" accept=".dxf" className="hidden" onChange={onPickFile} />
              </label>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <button
                  onClick={() => toggleAll(true)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                >
                  全选
                </button>
                <button
                  onClick={() => toggleAll(false)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                >
                  全不选
                </button>
                <div className="ml-2 flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1">
                  <Search size={12} className="text-slate-400" />
                  <input
                    placeholder="按名称过滤"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-40 text-xs focus:outline-none"
                  />
                </div>
                <div className="ml-auto text-xs text-slate-500">
                  已选 {rows.filter((r) => r.selected).length} / {rows.length}
                </div>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-auto p-3">
                <div className="grid grid-cols-4 gap-3 lg:grid-cols-5">
                  {filtered.map(({ r, i }) => (
                    <div
                      key={i}
                      className={`flex flex-col rounded border-2 bg-white p-2 ${
                        r.selected ? "border-sky-400" : "border-slate-200"
                      }`}
                    >
                      <label className="flex cursor-pointer items-center gap-1 self-start text-[11px]">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={(e) => setRow(i, { selected: e.target.checked })}
                        />
                        导入
                      </label>
                      <div className="my-1 flex h-32 items-center justify-center rounded bg-slate-50">
                        {r.preview ? (
                          <img
                            src={r.preview}
                            alt={r.name}
                            className="max-h-32 max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">无预览</span>
                        )}
                      </div>
                      <input
                        className="mb-1 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                        value={r.name}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                      />
                      <select
                        className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                        value={r.category}
                        onChange={(e) =>
                          setRow(i, { category: e.target.value as CustomBlockCategory })
                        }
                      >
                        {CATEGORY_OPTS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                        <span>{r.block.entities.length} 实体</span>
                        <span>
                          {(r.block.bbox.maxX - r.block.bbox.minX).toFixed(0)}×
                          {(r.block.bbox.maxY - r.block.bbox.minY).toFixed(0)}mm
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {filtered.length === 0 && (
                  <div className="py-12 text-center text-sm text-slate-400">无匹配项</div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">
                  ⓘ 可以稍后在"我的图块"面板里调整属性、关联设备主数据
                </div>
                <button
                  onClick={onClose}
                  className="ml-auto rounded border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={onConfirm}
                  className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700"
                >
                  导入选中（{rows.filter((r) => r.selected).length}）
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** 简单按名称启发式归类 */
function guessCategory(blockName: string): CustomBlockCategory {
  const n = blockName.toLowerCase();
  if (/(kuka|fanuc|abb|robot|kr\d+|irb|m-?\d)/.test(n)) return "robot";
  if (/(jig|fix|fixture|clamp|geo|jig)/.test(n)) return "fixture";
  if (/(conv|belt|roller|输送)/.test(n)) return "conveyor";
  if (/(buffer|store|rack|料)/.test(n)) return "material_buffer";
  if (/(col|column|wall|柱|墙|door|门|build)/.test(n)) return "structural";
  if (/(station|工位)/.test(n)) return "manual_station";
  return "other";
}
