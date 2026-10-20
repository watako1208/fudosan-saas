"use client";
import { EditForm, FormSection, TextField, SelectField, TextArea } from "@/components/EditForm";
import { executeContract, createChangeVersion } from "@/lib/server/actions/contracts";

type Opt = { value: string; label: string };

/** 締結記録: 署名済み書類・締結日・確認者を記録する（外部の電子署名は行わない） */
export function ExecuteForm({ contractId, attachments, staff, defaultBy, today }: { contractId: string; attachments: Opt[]; staff: Opt[]; defaultBy: string; today: string }) {
  return (
    <EditForm
      action={executeContract.bind(null, contractId)}
      initial={{ executedAt: today, executedBy: defaultBy, attachmentId: attachments.length === 1 ? attachments[0].value : "" }}
      cancelHref={`/contracts/${contractId}`}
      buttons={[{ label: "締結を記録", intent: "execute", primary: true, confirm: "締結を記録します。契約条件（版）は確定され、以後は条件変更の版でのみ変更できます。よろしいですか？" }]}
    >
      <FormSection title="締結の記録" desc="当事者が署名・押印した契約書（PDF・画像）を登録し、確認者を記録します。">
        <SelectField name="attachmentId" label="署名済み書類" required options={attachments} emptyLabel={attachments.length ? "選択してください" : "先に下の「書類の登録」からファイルを登録してください"} className="sm:col-span-2" />
        <TextField name="executedAt" label="締結日" type="date" required />
        <SelectField name="executedBy" label="確認者" required options={staff} />
      </FormSection>
    </EditForm>
  );
}

/** 条件変更（B05）: 変更開始日と理由を入力して新しい版を作成する */
export function ChangeVersionForm({ contractId, minDate }: { contractId: string; minDate: string }) {
  return (
    <EditForm
      action={createChangeVersion.bind(null, contractId)}
      initial={{}}
      cancelHref={`/contracts/${contractId}?tab=versions`}
      buttons={[{ label: "新しい版を作成して条件を編集", intent: "create", primary: true }]}
    >
      <FormSection title="条件変更（新しい版）" desc={`変更開始日は現在の版の適用開始日（${minDate}）より後の日付にしてください。現在の条件をコピーした下書きの版を作成し、続けて条件を編集します。`}>
        <TextField name="effectiveFrom" label="変更開始日" type="date" required />
        <TextArea name="changeReason" label="変更理由" required rows={3} className="sm:col-span-2" />
      </FormSection>
    </EditForm>
  );
}
