/**
 * Excel 导出：M+E 清单 + CT 表（多 sheet 单文件）
 */
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import type { Project } from "@ilp/schema";

export function exportProjectToExcel(p: Project): void {
  const wb = XLSX.utils.book_new();

  // ---- M+E 清单 ----
  const meRows = p.equipment.map((e, i) => ({
    序号: i + 1,
    名称: e.name,
    类别: e.category,
    型号: e.modelId ?? "",
    "宽W(mm)": e.footprint.w,
    "深H(mm)": e.footprint.h,
    "可达(mm)": e.reach ?? "",
    "单价(万)": e.unitCost,
  }));
  const meSheet = XLSX.utils.json_to_sheet(meRows);
  meSheet["!cols"] = [
    { wch: 6 },
    { wch: 24 },
    { wch: 10 },
    { wch: 22 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, meSheet, "M+E 清单");

  // ---- CT 表（按工位平铺） ----
  const ctRows: Record<string, unknown>[] = [];
  for (const st of p.stations) {
    const ops = p.operations.filter((o) => o.stationId === st.id);
    const total = ops.reduce((s, o) => s + (o.cycleTimeSec || 0), 0);
    const target = st.targetTaktSec ?? 0;
    if (ops.length === 0) {
      ctRows.push({
        工位: st.name,
        "目标节拍(s)": target,
        工序: "",
        "CT(s)": "",
        累计: 0,
        UPH: 0,
        是否超节拍: target > 0 && 0 > target ? "是" : "否",
      });
    } else {
      ops.forEach((op, idx) => {
        ctRows.push({
          工位: idx === 0 ? st.name : "",
          "目标节拍(s)": idx === 0 ? target : "",
          工序: op.name,
          "CT(s)": op.cycleTimeSec,
          累计: idx === ops.length - 1 ? total : "",
          UPH: idx === ops.length - 1 && total > 0 ? Math.floor(3600 / total) : "",
          是否超节拍: idx === ops.length - 1 && target > 0 ? (total > target ? "是" : "否") : "",
        });
      });
    }
  }
  const ctSheet = XLSX.utils.json_to_sheet(ctRows);
  ctSheet["!cols"] = [
    { wch: 14 },
    { wch: 14 },
    { wch: 24 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ctSheet, "CT 表");

  // ---- 项目摘要 ----
  const totalCost = p.equipment.reduce((s, e) => s + (e.unitCost || 0), 0);
  const summary = [
    { 项: "项目名称", 值: p.meta.name },
    { 项: "更新时间", 值: p.meta.updatedAt },
    { 项: "设备数", 值: p.equipment.length },
    { 项: "工位数", 值: p.stations.length },
    { 项: "工序数", 值: p.operations.length },
    { 项: "投资估算(万元)", 值: totalCost },
  ];
  const sumSheet = XLSX.utils.json_to_sheet(summary);
  sumSheet["!cols"] = [{ wch: 16 }, { wch: 32 }];
  XLSX.utils.book_append_sheet(wb, sumSheet, "摘要");

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safeName = p.meta.name.replace(/[\\/:*?"<>|]/g, "_");
  saveAs(blob, `${safeName}.xlsx`);
}
