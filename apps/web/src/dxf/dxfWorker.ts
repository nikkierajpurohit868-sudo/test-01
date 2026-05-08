/**
 * DXF 解析 Worker
 *  - 主线程 postMessage({ type: 'parse', text, fileSize })
 *  - Worker 回 { type: 'progress', payload } 多次
 *  - 完成 { type: 'done', payload: ParsedDxf } 或 { type: 'error', message }
 */
/// <reference lib="webworker" />
import { parseDxfText, extractDxfBlocksText, type DxfProgress } from "./parseDxf";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  const onProgress = (p: DxfProgress) => ctx.postMessage({ type: "progress", payload: p });
  try {
    if (msg?.type === "parseFull") {
      const result = await parseDxfText(msg.text as string, msg.fileSize as number, onProgress);
      ctx.postMessage({ type: "done", payload: result });
    } else if (msg?.type === "extractBlocks") {
      const result = await extractDxfBlocksText(
        msg.text as string,
        msg.fileSize as number,
        msg.fileName as string,
        onProgress
      );
      ctx.postMessage({ type: "done", payload: result });
    } else {
      ctx.postMessage({ type: "error", message: `unknown msg type: ${msg?.type}` });
    }
  } catch (e) {
    ctx.postMessage({ type: "error", message: (e as Error).message });
  }
};
