/**
 * Dexie / IndexedDB 持久化：单项目自动保存
 * （M2 时改造成多项目 + Yjs 同步）
 */
import Dexie, { type Table } from "dexie";
import { Project as ProjectSchema, type Project } from "@ilp/schema";

interface ProjectRow {
  id: string;
  data: Project;
  updatedAt: string;
}

class ILPDB extends Dexie {
  projects!: Table<ProjectRow, string>;
  constructor() {
    super("ilp");
    this.version(1).stores({ projects: "id, updatedAt" });
  }
}

export const db = new ILPDB();
const ACTIVE_KEY = "__active__";

export async function saveProject(p: Project): Promise<void> {
  await db.projects.put({ id: ACTIVE_KEY, data: p, updatedAt: p.meta.updatedAt });
}

export async function loadActiveProject(): Promise<Project | null> {
  const row = await db.projects.get(ACTIVE_KEY);
  if (!row) return null;
  // 用 zod 重新解析，自动补齐新字段默认值（schema 演进时的迁移点）
  const parsed = ProjectSchema.safeParse(row.data);
  if (parsed.success) return parsed.data;
  console.warn("[loadActiveProject] schema parse failed, using raw:", parsed.error);
  return row.data as Project;
}

export async function clearActiveProject(): Promise<void> {
  await db.projects.delete(ACTIVE_KEY);
}
