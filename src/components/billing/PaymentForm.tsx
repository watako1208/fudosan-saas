"use client";
import { EditForm, FormSection, TextField, MoneyField } from "@/components/EditForm";
import { savePayment } from "@/lib/server/actions/payments";

/** S17 入金の手入力（銀行接続はしない）。配分済みの入金は入金日・金額を変更できない */
export function PaymentForm({ initial, version, cancelHref }: { initial: Record<string, unknown>; version?: number; cancelHref: string }) {
  return (
    <EditForm
      action={savePayment}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      fieldLabels={{ date: "入金日", amount: "金額", payerName: "名義", reference: "参照番号", account: "口座" }}
      buttons={[{ label: "保存", intent: "save", primary: true }]}
    >
      <input type="hidden" name="id" value={String(initial.id ?? "")} />
      <FormSection title="入金明細">
        <TextField name="date" label="入金日" type="date" required />
        <MoneyField name="amount" label="金額" required help="円単位の整数" />
        <TextField name="payerName" label="名義（振込依頼人）" required help="照合候補の判定に使います（例: ヤマダ タロウ）" />
        <TextField name="reference" label="参照番号" />
        <TextField name="account" label="入金口座" />
      </FormSection>
    </EditForm>
  );
}
