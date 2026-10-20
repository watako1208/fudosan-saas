"use client";
import { EditForm, FormSection, TextField } from "@/components/EditForm";
import { saveInvoice } from "@/lib/server/actions/billing";
import { LineEditor, EditableLine, ItemTypeOption } from "./LineEditor";
import { PartyPicker } from "./PartyPicker";
import type { Rounding, TaxSetting } from "@/lib/domain/money";

/** S16 請求の作成・下書き編集。確定は billing.confirm 権限がある場合のみ */
export function InvoiceForm({
  initial,
  version,
  billToOptions,
  itemTypes,
  lines,
  lockedLines,
  canConfirm,
  cancelHref,
  isMonthly,
  lineRounding,
  taxRounding,
}: {
  initial: Record<string, unknown>;
  version?: number;
  billToOptions: { value: string; label: string }[];
  itemTypes: ItemTypeOption[];
  lines: EditableLine[];
  lockedLines?: { name: string; amount: number; formula: string | null; tax: TaxSetting }[];
  canConfirm: boolean;
  cancelHref: string;
  isMonthly?: boolean;
  lineRounding: Rounding;
  taxRounding: Rounding;
}) {
  return (
    <EditForm
      action={saveInvoice}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      fieldLabels={{ billToPartyId: "請求先", dueDate: "支払期限", issueDate: "発行日", period: "対象月", lines: "明細" }}
      buttons={[
        { label: "下書き保存", intent: "draft", primary: !canConfirm },
        ...(canConfirm ? [{ label: "確定", intent: "confirm", primary: true, confirm: "この請求を確定します。確定後は金額を変更できません（取消・訂正で対応）。" }] : []),
      ]}
    >
      <input type="hidden" name="id" value={String(initial.id ?? "")} />
      <input type="hidden" name="kind" value={String(initial.kind ?? "one_time")} />
      <input type="hidden" name="contractId" value={String(initial.contractId ?? "")} />
      <FormSection title="請求先・期限" desc="請求先の初期値は契約の現行版の借主です。">
        <PartyPicker name="billToPartyId" label="請求先" required options={billToOptions} defaultValue={String(initial.billToPartyId ?? "")} />
        <TextField name="issueDate" label="発行日" type="date" required />
        <TextField name="dueDate" label="支払期限" type="date" help="確定には必須です" />
        {!isMonthly && <TextField name="period" label="計上月（YYYY-MM）" placeholder="例: 2026-11" help="未入力の場合は発行日の月。月次締め済みの月は指定できません" />}
      </FormSection>
      <FormSection title="明細" desc="数量・単価は小数可（十進数で計算）。税区分・税率・税込/税抜は費目の初期値から明細ごとに変更できます。">
        <LineEditor itemTypes={itemTypes} initial={lines} lockedLines={lockedLines} lineRounding={lineRounding} taxRounding={taxRounding} />
      </FormSection>
    </EditForm>
  );
}
