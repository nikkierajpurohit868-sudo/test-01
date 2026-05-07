/**
 * Dexie / IndexedDB 持久化：单项目自动保存
 * （M2 时改造成多项目 + Yjs 同步）
 */
import Dexie, { type Table } from "dexie";
import type { Project } from "@ilp/schema";

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
  return row?.data ?? null;
}

export async function clearActiveProject(): Promise<void> {
  await db.projects.delete(ACTIVE_KEY);
}
