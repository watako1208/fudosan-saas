"use client";
import { useState } from "react";
import { EditForm, FormSection, TextField, SelectField, TextArea, MoneyField } from "@/components/EditForm";
import { PartyPicker, PickItem } from "@/components/parties/PartyPicker";
import { TargetsPicker, TargetItem } from "./TargetsPicker";
import type { ActionResult } from "@/lib/server/action";

export function DealForm({
  action,
  initial,
  version,
  cancelHref,
  staff,
  stores,
  customer,
  targets,
  isNew,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  staff: { value: string; label: string }[];
  stores: { value: string; label: string }[];
  customer: PickItem | null;
  targets: TargetItem[];
  isNew: boolean;
}) {
  const [kind, setKind] = useState<string>((initial.kind as string) || "rental");
  const sides = kind === "sale"
    ? [{ value: "buyer", label: "買主側（購入希望者の案件）" }, { value: "seller", label: "売主側（売却の案件）" }]
    : [{ value: "tenant", label: "借主側（入居希望者の案件）" }, { value: "landlord", label: "貸主側（募集の受託）" }];
  return (
    <EditForm
      action={action}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      fieldLabels={{ title: "案件名", customerId: "顧客", assigneeUid: "担当", expectedAmount: "見込金額", nextActionDate: "次回対応日" }}
    >
      <FormSection title="案件の区分">
        <div>
          <label htmlFor="kind" className="label">賃貸・売買<span className="ml-1 text-xs text-danger">必須</span></label>
          {isNew ? (
            <select id="kind" name="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="rental">賃貸仲介</option>
              <option value="sale">売買仲介</option>
            </select>
          ) : (
            <>
              <input type="hidden" name="kind" value={kind} />
              <p className="flex min-h-10 items-center">{kind === "sale" ? "売買仲介" : "賃貸仲介"}（変更不可）</p>
            </>
          )}
        </div>
        <SelectField key={kind} name="side" label={kind === "sale" ? "売主側・買主側" : "借主側・貸主側"} required={kind === "sale"} allowEmpty={false} options={sides} />
        <TextField name="title" label="案件名" required placeholder="例: 山田様 住替え（2LDK・世田谷区）" />
      </FormSection>
      <FormSection title="顧客・対象物件">
        <PartyPicker name="customerId" label="顧客" initial={customer} help="進行状態を進めるには顧客の設定が必要です" />
        <TargetsPicker initial={targets} />
      </FormSection>
      <FormSection title="担当・見込み・次回対応">
        <SelectField name="assigneeUid" label="担当者" options={staff} emptyLabel="未設定" />
        <SelectField name="storeId" label="担当店舗" options={stores} emptyLabel="店舗未設定（全店共有）" />
        <MoneyField name="expectedAmount" label="見込金額（仲介手数料など）" />
        <TextField name="nextActionDate" label="次回対応日" type="date" />
        <TextField name="nextAction" label="次回対応の内容" className="sm:col-span-2" />
      </FormSection>
      <FormSection title="希望条件">
        <TextArea name="conditions" label="希望条件" rows={5} className="sm:col-span-2 lg:col-span-3" help="エリア・予算・間取り・入居（引渡）時期・こだわり条件など" />
      </FormSection>
    </EditForm>
  );
}
