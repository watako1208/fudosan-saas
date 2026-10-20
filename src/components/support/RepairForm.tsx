"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea } from "@/components/EditForm";
import { EntityPicker, PropertyUnitPicker } from "./Pickers";
import type { ActionResult } from "@/lib/server/action";

/** 修繕登録（見積明細は別画面で入力する） */
export function RepairForm({
  action,
  initial,
  version,
  cancelHref,
  staff,
  vendorLabel,
  propertyLabel,
  inquiryId,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  staff: { value: string; label: string }[];
  vendorLabel?: string | null;
  propertyLabel?: string | null;
  inquiryId?: string | null;
}) {
  return (
    <EditForm action={action} initial={initial} version={version} cancelHref={cancelHref} fieldLabels={{ symptom: "症状", equipment: "対象設備", scheduledDate: "施工予定日" }}>
      {inquiryId && <input type="hidden" name="inquiryId" value={inquiryId} />}
      <FormSection title="修繕対象">
        <PropertyUnitPicker propertyLabel={propertyLabel} />
        <TextField name="equipment" label="対象設備" help="例: 給湯器、エアコン、浴室換気扇" />
        <TextArea name="symptom" label="症状・依頼内容" required className="sm:col-span-2 lg:col-span-3" />
      </FormSection>
      <FormSection title="業者・担当・予定" desc="費用負担は見積明細ごとに入力します（写真だけから負担者を判断しません）">
        <EntityPicker kind="vendor" name="vendorPartyId" label="依頼先業者" initialLabel={vendorLabel} help="顧客台帳で役割「工事業者」の人・法人から検索します" />
        <SelectField name="assigneeUid" label="担当" options={staff} emptyLabel="未設定" />
        <TextField name="scheduledDate" label="施工予定日" type="date" />
      </FormSection>
    </EditForm>
  );
}
