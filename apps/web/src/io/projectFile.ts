/**
 * .ilp.zip 项目包导入/导出
 *  zip 内部结构:
 *    project.json   - Project schema 数据
 *    assets/*       - DXF / 图片等大文件（M1 仅占位）
 */
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { Project } from "@ilp/schema";

export async function exportProjectZip(project: Project): Promise<void> {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(project, null, 2));
  zip.folder("assets");
  const blob = await zip.generateAsync({ type: "blob" });
  const safeName = project.meta.name.replace(/[\\/:*?"<>|]/g, "_");
  saveAs(blob, `${safeName}.ilp.zip`);
}

export async function importProjectZip(file: File): Promise<Project> {
  const zip = await JSZip.loadAsync(file);
  const json = await zip.file("project.json")?.async("string");
  if (!json) throw new Error("无效的 .ilp.zip：缺少 project.json");
  const raw = JSON.parse(json);
  return Project.parse(raw);
}
