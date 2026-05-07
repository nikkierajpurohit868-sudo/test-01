import { useProjectStore, selectSelectedItem, selectSelectedEquipment } from "@/store/projectStore";

export function PropertiesPanel() {
  const item = useProjectStore(selectSelectedItem);
  const eq = useProjectStore(selectSelectedEquipment);
  const updateCanvasItem = useProjectStore((s) => s.updateCanvasItem);
  const updateEquipment = useProjectStore((s) => s.updateEquipment);

  if (!item) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
          属性
        </div>
        <div className="flex-1 p-3 text-xs text-slate-400">
          在画布上选中一个对象以查看属性
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
        属性 · {eq?.name ?? item.label ?? item.id.slice(0, 6)}
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-3 text-xs">
        <Section title="画布对象">
          <Field label="X (mm)">
            <NumInput
              value={item.x}
              onChange={(v) => updateCanvasItem(item.id, { x: v })}
            />
          </Field>
          <Field label="Y (mm)">
            <NumInput
              value={item.y}
              onChange={(v) => updateCanvasItem(item.id, { y: v })}
            />
          </Field>
          <Field label="旋转 (°)">
            <NumInput
              value={item.rotation}
              onChange={(v) => updateCanvasItem(item.id, { rotation: v })}
            />
          </Field>
          <Field label="标注">
            <input
              className="w-full rounded border border-slate-300 px-2 py-1"
              value={item.label ?? ""}
              onChange={(e) => updateCanvasItem(item.id, { label: e.target.value })}
            />
          </Field>
        </Section>

        {eq && (
          <Section title="设备 (M+E)">
            <Field label="名称">
              <input
                className="w-full rounded border border-slate-300 px-2 py-1"
                value={eq.name}
                onChange={(e) => updateEquipment(eq.id, { name: e.target.value })}
              />
            </Field>
            <Field label="类别">
              <input
                disabled
                className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1"
                value={eq.category}
              />
            </Field>
            <Field label="占地宽 W (mm)">
              <NumInput
                value={eq.footprint.w}
                onChange={(v) =>
                  updateEquipment(eq.id, { footprint: { ...eq.footprint, w: Math.max(1, v) } })
                }
              />
            </Field>
            <Field label="占地深 H (mm)">
              <NumInput
                value={eq.footprint.h}
                onChange={(v) =>
                  updateEquipment(eq.id, { footprint: { ...eq.footprint, h: Math.max(1, v) } })
                }
              />
            </Field>
            <Field label="可达半径 (mm)">
              <NumInput
                value={eq.reach ?? 0}
                onChange={(v) => updateEquipment(eq.id, { reach: v || undefined })}
              />
            </Field>
            <Field label="单价 (万元)">
              <NumInput
                value={eq.unitCost}
                onChange={(v) => updateEquipment(eq.id, { unitCost: v })}
              />
            </Field>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </div>
      <div className="space-y-1.5 rounded border border-slate-200 bg-white p-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[80px_1fr] items-center gap-2">
      <span className="text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      className="w-full rounded border border-slate-300 px-2 py-1"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        onChange(Number.isFinite(v) ? v : 0);
      }}
    />
  );
}
