import { useEffect, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { Canvas } from "@/canvas/Canvas";
import { EquipmentLibraryPanel } from "@/panels/EquipmentLibraryPanel";
import { DxfPanel } from "@/panels/DxfPanel";
import { PropertiesPanel } from "@/panels/PropertiesPanel";
import { MEListPanel } from "@/panels/MEListPanel";
import { CTPanel } from "@/panels/CTPanel";
import { useProjectStore } from "@/store/projectStore";
import { loadActiveProject } from "@/db/dexie";

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

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        {/* 左：设备库 + DXF 列表 */}
        <div className="flex w-56 flex-col border-r border-slate-200 bg-slate-50">
          <div className="flex-1 min-h-0">
            <EquipmentLibraryPanel />
          </div>
          <DxfPanel />
        </div>

        {/* 中：画布 + 底部表格 */}
        <div className="flex flex-1 min-w-0 flex-col">
          <div className="flex-1 min-h-0">
            <Canvas />
          </div>
          <div className="h-72 border-t border-slate-200 bg-white flex flex-col">
            <div className="flex border-b border-slate-200 bg-slate-50 px-2">
              <TabBtn active={bottomTab === "me"} onClick={() => setBottomTab("me")}>
                M+E 清单
              </TabBtn>
              <TabBtn active={bottomTab === "ct"} onClick={() => setBottomTab("ct")}>
                CT 表
              </TabBtn>
            </div>
            <div className="flex-1 min-h-0">
              {bottomTab === "me" ? <MEListPanel /> : <CTPanel />}
            </div>
          </div>
        </div>

        {/* 右：属性 */}
        <div className="w-72 border-l border-slate-200 bg-slate-50">
          <PropertiesPanel />
        </div>
      </div>
    </div>
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
