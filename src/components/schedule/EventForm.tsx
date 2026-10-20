"use client";
import { useState } from "react";
import { EditForm, FormSection, TextField, SelectField, TextArea, CheckField, useFormCtx } from "@/components/EditForm";
import { PartyPicker, PickItem, SearchSelect } from "@/components/parties/PartyPicker";
import { searchTargets, splitKey } from "@/components/deals/TargetsPicker";
import { EVENT_TYPE } from "@/lib/labels-deals";
import { opts } from "@/lib/labels";
import type { ActionResult } from "@/lib/server/action";

/** 物件（または部屋）を1件選ぶ。propertyId / unitId の hidden input に値が入る */
function PropertyUnitPicker({ initial }: { initial: { propertyId: string; unitId: string | null; label: string } | null }) {
  const { markDirty, errors } = useFormCtx();
  const [sel, setSel] = useState(initial);
  return (
    <div className="sm:col-span-2">
      <span className="label">物件・部屋</span>
      <input type="hidden" name="propertyId" value={sel?.propertyId ?? ""} />
      <input type="hidden" name="unitId" value={sel?.unitId ?? ""} />
      {sel ? (
        <div className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 py-1.5">
          <span className="font-medium">{sel.label}</span>
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => { setSel(null); markDirty(); }}>選び直す</button>
        </div>
      ) : (
        <SearchSelect
          placeholder="物件名・部屋番号・住所で検索"
          search={searchTargets}
          onPick={(it) => { setSel({ ...splitKey(it.id), label: it.label }); markDirty(); }}
        />
      )}
      {errors.propertyId && <p className="field-error">{errors.propertyId}</p>}
    </div>
  );
}

export function EventForm({
  action,
  initial,
  version,
  cancelHref,
  staff,
  party,
  property,
  dealLabel,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  staff: { value: string; label: string }[];
  party: PickItem | null;
  property: { propertyId: string; unitId: string | null; label: string } | null;
  dealLabel: string | null;
}) {
  return (
    <EditForm
      action={action}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      buttons={[
        { label: "重複を承知で保存", intent: "force", confirm: "担当者の他の予定と重なっていても保存します。よろしいですか？" },
        { label: "保存", intent: "save", primary: true },
      ]}
      fieldLabels={{ title: "件名", start: "開始", end: "終了", assigneeUid: "担当", place: "集合場所" }}
    >
      <input type="hidden" name="dealId" defaultValue={(initial.dealId as string) ?? ""} />
      <input type="hidden" name="_back" defaultValue={(initial._back as string) ?? ""} />
      <FormSection title="予定" desc="日時は日本時間で入力します。担当者の予定と重なる場合（移動時間を含む）は保存前に警告します">
        <TextField name="title" label="件名" required className="sm:col-span-2" />
        <SelectField name="type" label="種類" required allowEmpty={false} options={opts(EVENT_TYPE)} />
        <TextField name="start" label="開始日時" type="datetime-local" required />
        <TextField name="end" label="終了日時" type="datetime-local" required />
        <SelectField name="assigneeUid" label="担当者" options={staff} emptyLabel="未設定" />
        <TextField name="travelMinutes" label="移動時間（前後・分）" inputMode="numeric" help="移動を伴う予定は、前後にこの時間を確保して重複を確認します" />
        {dealLabel && (
          <div>
            <span className="label">関連案件</span>
            <p className="flex min-h-10 items-center">{dealLabel}</p>
          </div>
        )}
      </FormSection>
      <FormSection title="顧客・物件・場所">
        <PartyPicker name="partyId" label="顧客" initial={party} />
        <PropertyUnitPicker initial={property} />
        <TextField name="place" label="集合場所" className="sm:col-span-2" />
        <TextField name="keyPickup" label="鍵の受取方法" placeholder="例: 管理会社で受取／キーボックス（番号は社内メモに記載しない）" />
      </FormSection>
      <FormSection title="実施結果">
        <TextArea name="result" label="実施結果" className="sm:col-span-2 lg:col-span-3" />
        <CheckField name="done" label="実施済み" />
      </FormSection>
    </EditForm>
  );
}
