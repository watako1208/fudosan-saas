"use client";
import { useState } from "react";
import { EditForm, FormSection, TextField, SelectField, TextArea, useFormCtx } from "@/components/EditForm";
import { PartyPicker, PartyMultiPicker, PickItem } from "@/components/parties/PartyPicker";
import { APPLICATION_STATUS, LANDLORD_CHECK } from "@/lib/labels-deals";
import { opts } from "@/lib/labels";
import type { ActionResult } from "@/lib/server/action";

type Doc = { name: string; received: boolean; attachmentId: string | null };

function DocsEditor({ attachments }: { attachments: { id: string; label: string }[] }) {
  const { initial, markDirty, errors } = useFormCtx();
  const [docs, setDocs] = useState<Doc[]>(() => (Array.isArray(initial.submittedDocs) ? (initial.submittedDocs as Doc[]) : []));
  const set = (n: Doc[]) => {
    setDocs(n);
    markDirty();
  };
  const missing = docs.filter((d) => !d.received).length;
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <input type="hidden" name="submittedDocs" value={JSON.stringify(docs)} />
      <p className="mb-2 text-sm">
        受領 {docs.length - missing} / {docs.length} 件
        {missing > 0 && <span className="ml-2 font-semibold text-warn">未受領 {missing}件（状態「書類不足」の目安）</span>}
      </p>
      <ul className="space-y-2">
        {docs.map((d, i) => (
          <li key={i} className="grid grid-cols-1 items-center gap-2 rounded-md border border-line p-2 sm:grid-cols-[1.5fr_auto_1.5fr_auto]">
            <input className="input" aria-label="書類名" value={d.name} onChange={(e) => set(docs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <label className="flex min-h-10 items-center gap-2 text-sm whitespace-nowrap">
              <input type="checkbox" checked={d.received} onChange={(e) => set(docs.map((x, j) => (j === i ? { ...x, received: e.target.checked } : x)))} />
              受領済み
            </label>
            <select className="input" aria-label="添付ファイル" value={d.attachmentId ?? ""} onChange={(e) => set(docs.map((x, j) => (j === i ? { ...x, attachmentId: e.target.value || null } : x)))}>
              <option value="">添付なし</option>
              {attachments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(docs.filter((_, j) => j !== i))}>削除</button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => set([...docs, { name: "", received: false, attachmentId: null }])}>＋ 書類を追加</button>
      <p className="help">添付ファイルは保存後に下の「申込み書類」から登録し、ここで選択します。</p>
      {errors.submittedDocs && <p className="field-error">{errors.submittedDocs}</p>}
    </div>
  );
}

export function ApplicationForm({
  action,
  initial,
  version,
  cancelHref,
  applicant,
  occupants,
  units,
  attachments,
  canSensitive,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  applicant: PickItem | null;
  occupants: PickItem[];
  units: { value: string; label: string }[];
  attachments: { id: string; label: string }[];
  canSensitive: boolean;
}) {
  return (
    <EditForm action={action} initial={initial} version={version} cancelHref={cancelHref} fieldLabels={{ applicantId: "申込者", status: "状態", desiredMoveIn: "希望入居日" }}>
      <FormSection title="申込者・入居者">
        <PartyPicker name="applicantId" label="申込者" required initial={applicant} />
        <SelectField name="unitId" label="申込む部屋・区画" options={units} emptyLabel={units.length ? "選択してください" : "案件に部屋が設定されていません"} />
        <PartyMultiPicker name="occupantIds" label="同居人" initial={occupants} help="同居人も顧客として登録して選択します" />
        <TextField name="desiredMoveIn" label="希望入居日・引渡希望日" type="date" />
      </FormSection>
      <FormSection title="提出書類" desc="書類の受領状況を記録します">
        <DocsEditor attachments={attachments} />
      </FormSection>
      <FormSection title="確認・審査結果" desc="保証会社の審査は外部で実施し、結果のみを記録します（審査申請の連携は行いません）">
        <TextField name="guarantorCompany" label="保証会社名" />
        <SelectField name="landlordCheck" label="貸主確認" options={opts(LANDLORD_CHECK)} emptyLabel="未確認" />
        <SelectField name="status" label="状態" required allowEmpty={false} options={opts(APPLICATION_STATUS)} help="承認・否決・取下げにすると記録者と日時を保存します" />
        {canSensitive ? (
          <TextArea name="rejectReason" label="否決理由（閲覧権限者のみ）" className="sm:col-span-2 lg:col-span-3" help="状態が「否決」のときのみ保存されます。閲覧できるのは本人確認資料・審査結果の閲覧権限を持つ利用者のみです" />
        ) : (
          <p className="text-sm text-muted sm:col-span-2 lg:col-span-3">否決理由は閲覧権限を持つ利用者のみ表示・編集できます。</p>
        )}
      </FormSection>
    </EditForm>
  );
}
