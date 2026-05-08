import {
  FilePlus2,
  FolderOpen,
  Save,
  FileSpreadsheet,
  Image as ImageIcon,
  Magnet,
  PackagePlus,
  Zap,
} from "lucide-react";
import { useRef, useState } from "react";
import { useProjectStore } from "@/store/projectStore";
import { exportProjectZip, importProjectZip } from "@/io/projectFile";
import { exportProjectToExcel } from "@/io/excelExport";
import { parseDxfFile, type DxfProgress } from "@/dxf/parseDxf";
import { DxfProgressOverlay } from "@/components/DxfProgressOverlay";
import { BlockImportWizard } from "@/components/BlockImportWizard";
import { BatchSlimDialog } from "@/components/BatchSlimDialog";

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const loadProject = useProjectStore((s) => s.loadProject);
  const resetProject = useProjectStore((s) => s.resetProject);
  const renameProject = useProjectStore((s) => s.renameProject);
  const addDxfBackground = useProjectStore((s) => s.addDxfBackground);
  const snapStep = useProjectStore((s) => s.snapStep);
  const setSnapStep = useProjectStore((s) => s.setSnapStep);
  const fileRef = useRef<HTMLInputElement>(null);
  const dxfRef = useRef<HTMLInputElement>(null);
  const [dxfProgress, setDxfProgress] = useState<DxfProgress | null>(null);
  const [showBlockWizard, setShowBlockWizard] = useState(false);
  const [showBatchSlim, setShowBatchSlim] = useState(false);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const p = await importProjectZip(f);
      loadProject(p);
    } catch (err) {
      alert(`导入失败: ${(err as Error).message}`);
    } finally {
      e.target.value = "";
    }
  };

  const onPickDxf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const sizeMB = f.size / 1024 / 1024;
    if (sizeMB > 50) {
      const ok = confirm(
        `DXF 文件较大 (${sizeMB.toFixed(0)} MB)，解析可能耗时数分钟，` +
          `期间 UI 仍可点击但 CPU 会满载。\n\n建议：\n` +
          `• CAD 中 PURGE 后导出（去除未引用块定义）\n` +
          `• 只导出关键图层（建筑、柱网、设备）\n` +
          `• 大于 200MB 的总图建议先在 CAD 中裁剪到子区域\n\n继续解析？`
      );
      if (!ok) {
        e.target.value = "";
        return;
      }
    }
    try {
      const parsed = await parseDxfFile(f, (p) => setDxfProgress(p));
      const summary =
        `已识别 ${parsed.entities.length} 个图元（INSERT 展开 ${parsed.insertsExpanded} 次）\n` +
        `单位换算: ×${parsed.unitScale} → mm\n` +
        `包围盒: ${formatBBox(parsed.bbox)}\n\n` +
        `按 DXF 类型统计:\n${formatCounts(parsed.stats)}` +
        (Object.keys(parsed.ignored).length
          ? `\n\n⚠ 已忽略类型(暂不支持):\n${formatCounts(parsed.ignored)}`
          : "") +
        (parsed.missingBlocks.length
          ? `\n\n⚠ 缺失块定义: ${parsed.missingBlocks.join(", ")}`
          : "");

      if (parsed.entities.length === 0) {
        alert("DXF 中未识别到任何受支持的图元。\n\n" + summary);
        return;
      }
      addDxfBackground({
        name: f.name.replace(/\.dxf$/i, ""),
        entities: parsed.entities,
        bbox: parsed.bbox,
        unitScale: parsed.unitScale,
        origin: { x: 0, y: 0 },
        rotation: 0,
        visible: true,
        opacity: 0.6,
        color: "#475569",
      });
      // 通知画布适配视图
      window.dispatchEvent(new CustomEvent("ilp:fit-view"));
      alert(summary);
    } catch (err) {
      alert(`DXF 导入失败: ${(err as Error).message}`);
    } finally {
      setDxfProgress(null);
      e.target.value = "";
    }
  };

  function formatCounts(c: Record<string, number>): string {
    return Object.entries(c)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");
  }
  function formatBBox(b: { minX: number; minY: number; maxX: number; maxY: number }): string {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    return `${w.toFixed(0)} × ${h.toFixed(0)} mm`;
  }

  return (
    <>
      <DxfProgressOverlay progress={dxfProgress} />
      {showBlockWizard && <BlockImportWizard onClose={() => setShowBlockWizard(false)} />}
    <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
      <div className="text-sm font-bold text-slate-800">ILP</div>
      <span className="text-slate-300">|</span>
      <input
        className="rounded border border-slate-200 px-2 py-1 text-sm focus:border-slate-400 focus:outline-none"
        value={project.meta.name}
        onChange={(e) => renameProject(e.target.value)}
        style={{ minWidth: 200 }}
      />
      <div className="ml-auto flex items-center gap-1">
        <label className="mr-2 flex items-center gap-1 text-xs text-slate-600">
          <Magnet size={14} />
          <span>吸附</span>
          <select
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
            value={snapStep}
            onChange={(e) => setSnapStep(parseFloat(e.target.value))}
          >
            <option value={0}>关</option>
            <option value={50}>50mm</option>
            <option value={100}>100mm</option>
            <option value={250}>250mm</option>
            <option value={500}>500mm</option>
            <option value={1000}>1m</option>
          </select>
        </label>
        <ToolBtn icon={<FilePlus2 size={14} />} label="新建" onClick={() => {
          if (confirm("新建项目将覆盖当前未导出的内容，确定？")) resetProject();
        }} />
        <ToolBtn
          icon={<ImageIcon size={14} />}
          label="导入 DXF 底图"
          onClick={() => dxfRef.current?.click()}
        />
        <ToolBtn
          icon={<PackagePlus size={14} />}
          label="抽取 DXF 图块"
          onClick={() => setShowBlockWizard(true)}
        />
        <ToolBtn
          icon={<Zap size={14} />}
          label="批量瘦身"
          onClick={() => setShowBatchSlim(true)}
        />
        <ToolBtn
          icon={<FolderOpen size={14} />}
          label="导入项目"
          onClick={() => fileRef.current?.click()}
        />
        <ToolBtn
          icon={<Save size={14} />}
          label="导出项目"
          onClick={() => exportProjectZip(project)}
        />
        <ToolBtn
          icon={<FileSpreadsheet size={14} />}
          label="导出 Excel"
          onClick={() => exportProjectToExcel(project)}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".zip,.ilp.zip"
          className="hidden"
          onChange={onPickFile}
        />
        <input
          ref={dxfRef}
          type="file"
          accept=".dxf"
          className="hidden"
          onChange={onPickDxf}
        />
      </div>
    </div>
    {showBatchSlim && <BatchSlimDialog onClose={() => setShowBatchSlim(false)} />}
    </>
  );
}

function ToolBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400 hover:bg-slate-50"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
