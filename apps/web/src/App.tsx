import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X } from "lucide-react";
import { Toolbar } from "@/components/Toolbar";
import { Canvas } from "@/canvas/Canvas";
import { EquipmentLibraryPanel } from "@/panels/EquipmentLibraryPanel";
import { DxfPanel } from "@/panels/DxfPanel";
import { CustomBlockPanel } from "@/panels/CustomBlockPanel";
import { PropertiesPanel } from "@/panels/PropertiesPanel";
import { MEListPanel } from "@/panels/MEListPanel";
import { CTPanel } from "@/panels/CTPanel";
import { Resizer, useResizable } from "@/components/Resizer";
import { useProjectStore } from "@/store/projectStore";
import { loadActiveProject } from "@/db/dexie";

/** localStorage 持久化的布尔开关 */
function usePersistedBool(key: string, def = false): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    if (typeof window === "undefined") return def;
    const raw = window.localStorage.getItem(key);
    return raw === null ? def : raw === "1";
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // ignore
    }
  };
  return [v, set];
}

type BottomTab = "me" | "ct";

export default function App() {
  const loadProject = useProjectStore((s) => s.loadProject);
  const [bottomTab, setBottomTab] = useState<BottomTab>("me");
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await loadActiveProject();
      if (p) loadProject(p);
      setBootstrapped(true);
    })();
  }, [loadProject]);

  if (!bootstrapped) {
    return <div className="flex h-full items-center justify-center text-slate-500">加载中…</div>;
  }

  return <AppLayout bottomTab={bottomTab} setBottomTab={setBottomTab} />;
}

function AppLayout({
  bottomTab,
  setBottomTab,
}: {
  bottomTab: BottomTab;
  setBottomTab: (t: BottomTab) => void;
}) {
  const [leftW, setLeftW, resetLeft] = useResizable("ilp.layout.leftW", 224, 160, 480);
  const [rightW, setRightW, resetRight] = useResizable("ilp.layout.rightW", 288, 200, 560);
  const [bottomH, setBottomH, resetBottom] = useResizable("ilp.layout.bottomH", 288, 120, 600);
  const [leftClosed, setLeftClosed] = usePersistedBool("ilp.layout.leftClosed", false);
  const [rightClosed, setRightClosed] = usePersistedBool("ilp.layout.rightClosed", false);
  const [bottomClosed, setBottomClosed] = usePersistedBool("ilp.layout.bottomClosed", false);

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        {/* 左：设备库 + 我的图块 + DXF 列表 */}
        {leftClosed ? (
          <CollapsedStrip
            side="left"
            label="设备库 / 图块"
            onExpand={() => setLeftClosed(false)}
          />
        ) : (
          <>
            <div
              className="relative flex flex-col border-r border-slate-200 bg-slate-50"
              style={{ width: leftW }}
            >
              <PanelHeader title="设备库 / 我的图块" onClose={() => setLeftClosed(true)} />
              <div className="flex-1 min-h-0 overflow-y-auto">
                <EquipmentLibraryPanel />
              </div>
              <CustomBlockPanel />
              <DxfPanel />
            </div>
            <Resizer
              direction="vertical"
              onResize={(dx) => setLeftW(leftW + dx)}
              onReset={resetLeft}
            />
          </>
        )}

        {/* 中：画布 + 底部表格 */}
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex-1 min-h-0">
            <Canvas />
          </div>
          {bottomClosed ? (
            <CollapsedStrip
              side="bottom"
              label={bottomTab === "me" ? "M+E 清单" : "CT 表"}
              onExpand={() => setBottomClosed(false)}
            />
          ) : (
            <>
              <Resizer
                direction="horizontal"
                onResize={(dy) => setBottomH(bottomH - dy)}
                onReset={resetBottom}
              />
              <div
                className="border-t border-slate-200 bg-white flex flex-col"
                style={{ height: bottomH }}
              >
                <div className="flex items-center border-b border-slate-200 bg-slate-50 px-2">
                  <TabBtn active={bottomTab === "me"} onClick={() => setBottomTab("me")}>
                    M+E 清单
                  </TabBtn>
                  <TabBtn active={bottomTab === "ct"} onClick={() => setBottomTab("ct")}>
                    CT 表
                  </TabBtn>
                  <button
                    onClick={() => setBottomClosed(true)}
                    title="收起"
                    className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  {bottomTab === "me" ? <MEListPanel /> : <CTPanel />}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 右：属性 */}
        {rightClosed ? (
          <CollapsedStrip
            side="right"
            label="属性"
            onExpand={() => setRightClosed(false)}
          />
        ) : (
          <>
            <Resizer
              direction="vertical"
              onResize={(dx) => setRightW(rightW - dx)}
              onReset={resetRight}
            />
            <div
              className="relative flex flex-col border-l border-slate-200 bg-slate-50"
              style={{ width: rightW }}
            >
              <PanelHeader title="属性" onClose={() => setRightClosed(true)} />
              <div className="flex-1 min-h-0 overflow-y-auto">
                <PropertiesPanel />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 面板顶部小标题栏 + 关闭按钮 */
function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-2 py-1">
      <span className="text-[11px] font-semibold text-slate-600">{title}</span>
      <button
        onClick={onClose}
        title="收起"
        className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** 折叠态：边缘细条，点击展开 */
function CollapsedStrip({
  side,
  label,
  onExpand,
}: {
  side: "left" | "right" | "bottom";
  label: string;
  onExpand: () => void;
}) {
  const isVert = side !== "bottom";
  const Icon = side === "left" ? ChevronRight : side === "right" ? ChevronLeft : ChevronUp;
  const borderClass =
    side === "left"
      ? "border-r"
      : side === "right"
      ? "border-l"
      : "border-t";
  return (
    <button
      onClick={onExpand}
      title={`展开 ${label}`}
      className={
        `group flex items-center justify-center bg-slate-100 ${borderClass} border-slate-200 hover:bg-sky-50 ` +
        (isVert ? "h-full w-6 flex-col gap-2 py-2" : "h-6 w-full gap-2")
      }
    >
      <Icon size={14} className="text-slate-500 group-hover:text-sky-600" />
      <span
        className="text-[11px] text-slate-500 group-hover:text-sky-700"
        style={isVert ? { writingMode: "vertical-rl", transform: "rotate(180deg)" } : undefined}
      >
        {label}
      </span>
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 text-xs border-b-2 -mb-px " +
        (active
          ? "border-sky-500 text-slate-800 font-semibold"
          : "border-transparent text-slate-500 hover:text-slate-700")
      }
    >
      {children}
    </button>
  );
}
