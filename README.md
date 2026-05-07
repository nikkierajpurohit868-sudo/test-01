# Industrial Layout Planner (ILP)

面向工艺规划师的"沙盘式"轻量 PD 系统：Web 端 2D 画布 + 结构化 BOP / M+E / CT / 预算数据模型。

## 现状（M1 单机版）

纯前端 SPA，无后端、无账号；项目以 `.ilp.zip` 文件交付。

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 http://localhost:5173

## 目录结构

```
apps/web/              # Vite + React SPA（画布 / 表格 / 面板）
packages/schema/       # zod 数据模型（与未来后端共享）
```

## 路线图

- **M1**: 画布 + 设备库 + M+E 清单 + CT 表 + DXF 底图 + 本地持久化
- **M2**: 后端（FastAPI）+ Yjs 协同 + 版本树 + 预算引擎
- **M3**: 3D 预览 + 可行性几何校验 + BOP 模板沉淀
