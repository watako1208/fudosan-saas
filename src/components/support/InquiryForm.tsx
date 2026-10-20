"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea } from "@/components/EditForm";
import { EntityPicker, PropertyUnitPicker } from "./Pickers";
import { INQUIRY_CATEGORY, URGENCY, opts } from "@/lib/labels-support";
import type { ActionResult } from "@/lib/server/action";

export function InquiryForm({
  action,
  initial,
  version,
  cancelHref,
  staff,
  partyLabel,
  propertyLabel,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  staff: { value: string; label: string }[];
  partyLabel?: string | null;
  propertyLabel?: string | null;
}) {
  return (
    <EditForm
      action={action}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      fieldLabels={{ receivedAt: "受付日時", category: "分類", urgency: "緊急度", content: "内容", due: "期限", assigneeUid: "担当" }}
    >
      <FormSection title="受付内容">
        <TextField name="receivedAt" label="受付日時" type="datetime-local" required />
        <SelectField name="category" label="分類" options={opts(INQUIRY_CATEGORY)} required />
        <SelectField name="urgency" label="緊急度" options={opts(URGENCY)} allowEmpty={false} />
        <TextArea name="content" label="内容" required rows={5} className="sm:col-span-2 lg:col-span-3" />
      </FormSection>
      <FormSection title="相手・対象" desc="登録済みの顧客・入居者を選ぶか、未登録の場合は名前だけ入力してください">
        <EntityPicker kind="party" name="partyId" label="相手（登録済み）" initialLabel={partyLabel} />
        <TextField name="partyName" label="相手の名前（未登録の場合）" />
        <PropertyUnitPicker propertyLabel={propertyLabel} />
      </FormSection>
      <FormSection title="担当・期限">
        <SelectField name="assigneeUid" label="担当" options={staff} emptyLabel="未設定" />
        <TextField name="due" label="対応期限" type="date" />
      </FormSection>
    </EditForm>
  );
}
