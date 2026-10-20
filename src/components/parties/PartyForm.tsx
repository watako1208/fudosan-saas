"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { EditForm, FormSection, TextField, SelectField, TextArea, useFormCtx } from "@/components/EditForm";
import { PartyPicker, PickItem } from "./PartyPicker";
import { PARTY_ROLE, opts } from "@/lib/labels";
import { SUPPORT_STATUS } from "@/lib/labels-deals";
import { checkPartyDuplicates, type DuplicateCandidate } from "@/lib/server/actions/parties";
import type { ActionResult } from "@/lib/server/action";

/** 役割（関連先なし）の複数選択。関連先つきの役割は詳細画面の「役割・関連」で登録する */
function RoleChecks({ name = "manualRoles" }: { name?: string }) {
  const { initial, markDirty } = useFormCtx();
  const cur = new Set((initial[name] as string[] | undefined) ?? []);
  return (
    <fieldset className="sm:col-span-2 lg:col-span-3">
      <legend className="label">役割（関連先を問わない一般的な役割）</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {opts(PARTY_ROLE)
          .filter((o) => o.value !== "contact_person")
          .map((o) => (
            <label key={o.value} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" name={name} value={o.value} data-multi="1" defaultChecked={cur.has(o.value)} onChange={markDirty} className="h-4 w-4" />
              {o.label}
            </label>
          ))}
      </div>
      <p className="help">物件Xの貸主・案件Yの購入希望者など関連先つきの役割は、登録後に詳細画面の「役割・関連」から追加します（顧客を複製しません）。</p>
    </fieldset>
  );
}

function DuplicateCheck({ selfId }: { selfId?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [res, setRes] = useState<DuplicateCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    const form = box.current?.closest("form");
    if (!form) return;
    const fd = new FormData(form);
    const v: Record<string, unknown> = { id: selfId ?? "" };
    for (const k of ["type", "name", "kana", "phone", "mobile", "email"]) v[k] = fd.get(k) ?? "";
    setBusy(true);
    setErr(null);
    const r = await checkPartyDuplicates(v).catch(() => null);
    setBusy(false);
    if (!r) setErr("確認に失敗しました");
    else if (r.ok) setRes(r.data);
    else setErr(r.error);
  };
  return (
    <div ref={box} className="sm:col-span-2 lg:col-span-3">
      <button type="button" className="btn btn-secondary btn-sm" onClick={check} disabled={busy}>{busy ? "確認中…" : "重複候補を確認"}</button>
      <span className="help ml-2">同じ電話番号・メールアドレス、または同じ氏名と読みの顧客を表示します（自動統合はしません）</span>
      {err && <p className="text-sm text-danger">{err}</p>}
      {res && res.length === 0 && <p className="mt-2 text-sm text-ok">重複候補は見つかりませんでした</p>}
      {res && res.length > 0 && (
        <div className="mt-2 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm">
          <p className="font-semibold text-warn">重複の可能性がある顧客: {res.length}件</p>
          <ul className="mt-1 space-y-1">
            {res.map((c) => (
              <li key={c.id}>
                <Link href={`/parties/${c.id}`} target="_blank" className="text-primary underline">{c.number} {c.name}</Link>
                {c.kana && <span className="ml-1 text-muted">（{c.kana}）</span>}
                <span className="ml-2">{c.reasons.join("・")}が一致</span>
                {c.archived && <span className="ml-2 text-muted">アーカイブ済み</span>}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">同一人物の場合は既存の顧客に役割を追加してください。別人の場合はそのまま保存できます。</p>
        </div>
      )}
    </div>
  );
}

export function PartyForm({
  action,
  initial,
  version,
  cancelHref,
  staff,
  stores,
  corporation,
  selfId,
}: {
  action: (v: Record<string, unknown>) => Promise<ActionResult<{ redirect: string }>>;
  initial: Record<string, unknown>;
  version?: number;
  cancelHref: string;
  staff: { value: string; label: string }[];
  stores: { value: string; label: string }[];
  corporation?: PickItem | null;
  selfId?: string;
}) {
  const [type, setType] = useState<string>((initial.type as string) || "person");
  const corp = type === "corporation";
  return (
    <EditForm
      action={action}
      initial={initial}
      version={version}
      cancelHref={cancelHref}
      buttons={[
        { label: "重複を確認して保存", intent: "force", confirm: "重複候補がある場合でも別の顧客として保存します。よろしいですか？" },
        { label: "保存", intent: "save", primary: true },
      ]}
      fieldLabels={{ name: "氏名・名称", kana: "読み", phone: "電話", email: "メール", assigneeUid: "担当", supportStatus: "対応状態" }}
    >
      <FormSection title="区分・氏名">
        <div>
          <label htmlFor="type" className="label">個人・法人<span className="ml-1 text-xs text-danger">必須</span></label>
          <select id="type" name="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="person">個人</option>
            <option value="corporation">法人</option>
          </select>
        </div>
        <TextField name="name" label={corp ? "法人名" : "氏名"} required />
        <TextField name="kana" label={corp ? "法人名の読み" : "読み（フリガナ）"} />
        {!corp && <TextField name="birthDate" label="生年月日" type="date" />}
        {!corp && (
          <PartyPicker
            name="corporationId"
            label="所属法人（法人の担当者の場合）"
            type="corporation"
            initial={corporation}
            help="法人の担当者は個人として登録し、所属法人を関連づけます"
          />
        )}
      </FormSection>
      <FormSection title="連絡先">
        <TextField name="phone" label="電話番号" type="tel" inputMode="tel" />
        <TextField name="mobile" label="携帯電話" type="tel" inputMode="tel" />
        <TextField name="email" label="メールアドレス" type="email" inputMode="email" />
        <TextField name="postalCode" label="郵便番号" inputMode="numeric" />
        <TextField name="address" label="住所" className="sm:col-span-2" />
        <DuplicateCheck selfId={selfId} />
      </FormSection>
      <FormSection title="担当・対応">
        <SelectField name="assigneeUid" label="担当者" options={staff} emptyLabel="未設定" />
        <SelectField name="storeId" label="担当店舗" options={stores} emptyLabel="店舗未設定（全店共有）" />
        <SelectField name="supportStatus" label="対応状態" allowEmpty={false} options={opts(SUPPORT_STATUS)} />
        <RoleChecks />
      </FormSection>
      <FormSection title="希望条件・社内メモ">
        <TextArea name="preferences" label="希望条件" className="sm:col-span-2 lg:col-span-3" help="エリア・予算・間取り・入居時期など" />
        <TextArea name="memo" label="社内メモ" className="sm:col-span-2 lg:col-span-3" help="社内のみ。顧客ページなど外部利用者には表示されません" />
      </FormSection>
    </EditForm>
  );
}
