"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea, MoneyField } from "@/components/EditForm";
import { addDepositEntry } from "@/lib/server/actions/deposits";
import { DEPOSIT_KIND, DEPOSIT_HOLDER } from "@/lib/labels-contracts";
import { opts } from "@/lib/labels";

type Opt = { value: string; label: string };

/** 預り金エントリの記録（受入・充当・返金予定・返金実行・追加請求） */
export function DepositEntryForm({
  contractId,
  moveoutId,
  defaultHolder,
  attachments,
  today,
}: {
  contractId: string;
  moveoutId: string | null;
  defaultHolder: string | null;
  attachments: Opt[];
  today: string;
}) {
  return (
    <EditForm
      action={addDepositEntry.bind(null, contractId)}
      initial={{ date: today, holder: defaultHolder ?? "", kind: moveoutId ? "apply" : "receive" }}
      buttons={[{ label: "記録する", intent: "save", primary: true }]}
    >
      <input type="hidden" name="moveoutId" value={moveoutId ?? ""} />
      <FormSection title="預り金の記録" desc="充当は承認後に残高へ反映されます。返金予定は残高を減らさず、返金実行を記録した時点で減ります。">
        <SelectField name="kind" label="種類" required options={opts(DEPOSIT_KIND)} allowEmpty={false} />
        <MoneyField name="amount" label="金額" required />
        <TextField name="date" label="日付" type="date" required />
        <SelectField name="holder" label="保管主体" required options={opts(DEPOSIT_HOLDER)} help="貸主保管分は自社の現金残高に含めません" />
        <SelectField name="attachmentId" label="資料（振込記録など・任意）" options={attachments} emptyLabel="添付しない" className="sm:col-span-2" />
        <TextArea name="reason" label="内容・理由" rows={2} className="sm:col-span-2 lg:col-span-3" help="充当・追加請求は内訳（原状回復の項目など）を必ず入力してください" />
      </FormSection>
    </EditForm>
  );
}
