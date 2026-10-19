"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea } from "@/components/EditForm";
import { AreaEditor, AccessEditor } from "@/components/AreaEditor";
import { PROPERTY_KIND, opts } from "@/lib/labels";
import type { ActionResult } from "@/lib/server/action";

export function PropertyForm({
  action,
  initial,
  version,
  cancelHref,
  staff,
  stores,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  staff: { value: string; label: string }[];
  stores: { value: string; label: string }[];
}) {
  return (
    <EditForm
      action={action}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      fieldLabels={{ name: "名称", kind: "種別", address: "所在地", assigneeUid: "担当", storeId: "店舗" }}
    >
      <FormSection title="基本情報">
        <TextField name="name" label="物件名" required className="sm:col-span-2" />
        <SelectField name="kind" label="種別" required options={opts(PROPERTY_KIND)} />
        <SelectField name="storeId" label="担当店舗" options={stores} emptyLabel="店舗未設定（全店共有）" />
        <SelectField name="assigneeUid" label="担当者" options={staff} emptyLabel="未設定" />
      </FormSection>
      <FormSection title="所在地・交通">
        <TextField name="postalCode" label="郵便番号" inputMode="numeric" />
        <TextField name="address" label="所在地（住居表示）" className="sm:col-span-2" />
        <TextField name="lotNumber" label="地番" />
        <AccessEditor />
      </FormSection>
      <FormSection title="土地・建物">
        <TextField name="structure" label="構造" placeholder="例: RC造" />
        <TextField name="builtYearMonth" label="築年月" type="month" />
        <TextField name="floorsAbove" label="地上階数" inputMode="numeric" />
        <TextField name="floorsBelow" label="地下階数" inputMode="numeric" />
        <TextField name="rights" label="権利情報" placeholder="例: 所有権" className="sm:col-span-2" />
        <AreaEditor />
      </FormSection>
      <FormSection title="社内メモ">
        <TextArea name="memo" label="メモ" className="sm:col-span-2 lg:col-span-3" help="社内のみ。外部利用者には表示されません" />
      </FormSection>
    </EditForm>
  );
}
