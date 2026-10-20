"use client";
import { useState } from "react";
import { EditForm, FormSection, TextField, SelectField, useFormCtx } from "@/components/EditForm";
import { SearchSelect } from "@/components/parties/PartyPicker";
import { searchParties, searchRoleTargets } from "@/lib/server/actions/parties";
import type { ActionResult } from "@/lib/server/action";

const ENTITY_LABEL: Record<string, string> = { deal: "仲介案件", party: "顧客", property: "物件", contract: "契約" };

function EntityPicker({ initial }: { initial: { entity: string; entityId: string; label: string } | null }) {
  const { markDirty } = useFormCtx();
  const [entity, setEntity] = useState(initial?.entity ?? "");
  const [sel, setSel] = useState<{ id: string; label: string } | null>(initial ? { id: initial.entityId, label: initial.label } : null);
  return (
    <div className="sm:col-span-2 lg:col-span-3 grid grid-cols-1 gap-3 sm:grid-cols-[200px_1fr]">
      <input type="hidden" name="entity" value={sel ? entity : ""} />
      <input type="hidden" name="entityId" value={sel?.id ?? ""} />
      <label className="text-sm">
        <span className="label">関連先の種類</span>
        <select className="input" value={entity} onChange={(e) => { setEntity(e.target.value); setSel(null); markDirty(); }}>
          <option value="">関連先なし</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {entity && (
        <div>
          <span className="label">関連先</span>
          {sel ? (
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 py-1.5">
              <span className="font-medium">{sel.label}</span>
              <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => { setSel(null); markDirty(); }}>選び直す</button>
            </div>
          ) : (
            <SearchSelect
              placeholder="名称・番号で検索"
              search={(q) => (entity === "party" ? searchParties({ q }) : searchRoleTargets({ entity, q }))}
              onPick={(it) => { setSel(it); markDirty(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function TaskForm({
  action,
  initial,
  version,
  cancelHref,
  staff,
  entity,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  staff: { value: string; label: string }[];
  entity: { entity: string; entityId: string; label: string } | null;
}) {
  return (
    <EditForm action={action} initial={initial} version={version} cancelHref={cancelHref} fieldLabels={{ title: "件名", due: "期限", assigneeUid: "担当" }}>
      <input type="hidden" name="_back" defaultValue={(initial._back as string) ?? ""} />
      <FormSection title="タスク" desc="完了期限を持つ作業です（日時を持つ予定とは区別します）">
        <TextField name="title" label="件名" required className="sm:col-span-2" />
        <TextField name="due" label="期限" type="date" required />
        <SelectField name="assigneeUid" label="担当者" options={staff} emptyLabel="未設定" />
        <EntityPicker initial={entity} />
      </FormSection>
    </EditForm>
  );
}
