"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EditForm, FormSection, TextField, SelectField, TextArea, MoneyField } from "@/components/EditForm";
import { updateRenewal, createMoveout, updateMoveout, addBurdenDecision } from "@/lib/server/actions/lease";
import { RENEWAL_STATUS, RENEWAL_ANSWER, MOVEOUT_STATUS, BURDEN_PARTY } from "@/lib/labels-contracts";
import { opts } from "@/lib/labels";
import { moveoutImpact, ImpactInvoice } from "@/lib/domain/contracts";
import { yen } from "@/lib/domain/money";
import type { MonthlyItem } from "@/lib/domain/rules";

type Opt = { value: string; label: string };

export function RenewalForm({ id, initial, version }: { id: string; initial: Record<string, unknown>; version: number }) {
  return (
    <EditForm action={updateRenewal.bind(null, id)} initial={initial} version={version} cancelHref="/lease?tab=renewals" buttons={[{ label: "保存", intent: "save", primary: true }]}>
      <FormSection title="提示条件" desc="借主へ案内する更新条件です。「更新を確定」を押すまで契約は更新されません。">
        <MoneyField name="proposedRent" label="更新後の賃料（月額）" help="空欄の場合は現在の賃料のまま" />
        <MoneyField name="proposedFee" label="更新料" />
        <TextField name="proposedTermMonths" label="更新後の期間（か月）" inputMode="numeric" />
        <TextArea name="proposedNote" label="備考" rows={2} className="sm:col-span-2 lg:col-span-3" />
      </FormSection>
      <FormSection title="回答・手続き状態">
        <SelectField name="answer" label="借主の回答" options={opts(RENEWAL_ANSWER)} allowEmpty={false} />
        <SelectField name="status" label="手続き状態" options={opts(RENEWAL_STATUS).filter((o) => !["completed", "cancelled"].includes(o.value))} allowEmpty={false} />
      </FormSection>
    </EditForm>
  );
}

export function NewMoveoutForm({ contractId, today, contractLabel }: { contractId: string; today: string; contractLabel: string }) {
  return (
    <EditForm action={createMoveout} initial={{ contractId, requestedAt: today }} cancelHref={`/contracts/${contractId}?tab=renewal`} buttons={[{ label: "登録", intent: "create", primary: true }]}>
      <input type="hidden" name="contractId" value={contractId} />
      <FormSection title="解約の申出" desc={`対象: ${contractLabel}。登録すると部屋の入居状態を「退去予定」にします（募集状態は変更しません）。`}>
        <TextField name="requestedAt" label="申出日" type="date" required />
        <TextField name="desiredDate" label="希望解約日" type="date" />
        <TextArea name="impactNote" label="メモ" rows={2} className="sm:col-span-2 lg:col-span-3" />
      </FormSection>
    </EditForm>
  );
}

/** 解約・退去の編集。確認済み解約日を変えると、請求・精算への影響をその場で表示する（請求は変更しない） */
export function MoveoutForm({
  id,
  initial,
  version,
  contractId,
  contractStart,
  contractEnd,
  versionFrom,
  monthlyItems,
  invoices,
  invoicesReadable,
}: {
  id: string;
  initial: Record<string, unknown>;
  version: number;
  contractId: string;
  contractStart: string | null;
  contractEnd: string | null;
  versionFrom: string | null;
  monthlyItems: MonthlyItem[];
  invoices: ImpactInvoice[];
  invoicesReadable: boolean;
}) {
  const marker = useRef<HTMLInputElement>(null);
  const original = (initial.confirmedDate as string | null) ?? "";
  const [date, setDate] = useState(original);
  useEffect(() => {
    const form = marker.current?.form;
    if (!form) return;
    const read = () => setDate(((form.elements.namedItem("confirmedDate") as HTMLInputElement | null)?.value ?? "").trim());
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, []);
  const impact = useMemo(
    () => (date ? moveoutImpact({ confirmedDate: date, contractStart, contractEnd, versionFrom, monthlyItems, invoices }) : null),
    [date, contractStart, contractEnd, versionFrom, monthlyItems, invoices],
  );

  return (
    <EditForm action={updateMoveout.bind(null, id)} initial={initial} version={version} cancelHref="/lease?tab=moveouts" buttons={[{ label: "保存", intent: "save", primary: true }]}>
      <input ref={marker} type="hidden" name="_marker" value="" />
      <FormSection title="申出・解約日">
        <TextField name="requestedAt" label="申出日" type="date" required />
        <TextField name="desiredDate" label="希望解約日" type="date" />
        <TextField name="confirmedDate" label="確認済み解約日" type="date" help="「解約日確定」以降の状態に必要です" />
      </FormSection>
      <section className="card mb-4" aria-live="polite">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base">解約日による影響{date !== original && date ? <span className="ml-2 text-sm font-normal text-warn">（未保存の変更を反映して表示中）</span> : null}</h2>
          <p className="help">表示のみです。請求の作成・訂正は請求画面で行ってください（確定済みの請求は直接書き換えません）。</p>
        </div>
        <div className="card-pad space-y-4">
          {!impact ? (
            <p className="text-sm text-muted">確認済み解約日を入力すると、契約終了日の変更・最終月の日割り・影響する請求を表示します。</p>
          ) : (
            <>
              <p className="text-sm">
                契約終了日: <b>{impact.endBefore ?? "未設定"}</b> → <b>{impact.endAfter}</b>（退去精算の完了時に契約へ反映します）
              </p>
              <div>
                <p className="text-sm font-semibold">最終月（{impact.finalPeriod}）の日割り</p>
                {impact.finalMonth.length === 0 ? (
                  <p className="text-sm text-muted">対象となる月額費用はありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead><tr><th>費目</th><th>対象期間</th><th>計算式</th><th className="num">最終月額</th></tr></thead>
                      <tbody>
                        {impact.finalMonth.map((r) => (
                          <tr key={r.code}>
                            <td>{r.name}</td>
                            <td className="whitespace-nowrap">{r.from}〜{r.to}</td>
                            <td>{r.result?.formula ?? r.error}</td>
                            <td className="num font-semibold">{r.result ? yen(r.result.amount) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold">影響する既存の請求（{impact.finalPeriod}以降）</p>
                {!invoicesReadable ? (
                  <p className="text-sm text-muted">請求の閲覧権限がないため表示できません</p>
                ) : impact.affectedInvoices.length === 0 ? (
                  <p className="text-sm text-muted">該当する請求はありません</p>
                ) : (
                  <table className="table">
                    <thead><tr><th>請求番号</th><th>対象月</th><th>状態</th><th className="num">請求額</th><th>対応</th></tr></thead>
                    <tbody>
                      {impact.affectedInvoices.map((i) => (
                        <tr key={i.id}>
                          <td><Link className="text-primary hover:underline" href={`/billing/${i.id}`}>{i.number}</Link></td>
                          <td>{i.period}</td>
                          <td>{i.status === "confirmed" ? "確定" : "下書き"}</td>
                          <td className="num">{yen(i.total)}</td>
                          <td className="text-sm">{i.status === "confirmed" ? (i.period === impact.finalPeriod ? "日割りとの差額を調整・訂正" : "取消・訂正が必要") : "再計算または削除の対象"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <Link className="btn btn-secondary btn-sm" href={`/billing/new?contractId=${contractId}&kind=one_time`}>最終請求を作成</Link>
            </>
          )}
        </div>
      </section>
      <FormSection title="立会い・鍵・手続き状態">
        <TextField name="inspectionAt" label="立会い日時" type="datetime-local" />
        <TextField name="keysReturned" label="返却された鍵（本数）" inputMode="numeric" />
        <SelectField name="status" label="手続き状態" options={opts(MOVEOUT_STATUS).filter((o) => o.value !== "completed")} allowEmpty={false} />
        <TextArea name="impactNote" label="メモ（請求・精算への対応など）" rows={3} className="sm:col-span-2 lg:col-span-3" />
      </FormSection>
    </EditForm>
  );
}

export function BurdenForm({ moveoutId, staff, defaultBy }: { moveoutId: string; staff: Opt[]; defaultBy: string }) {
  return (
    <EditForm action={addBurdenDecision.bind(null, moveoutId)} initial={{ checkedBy: defaultBy, party: "lessee" }} buttons={[{ label: "判断を記録", intent: "save", primary: true }]}>
      <FormSection title="費用負担の判断を追加" desc="写真だけで負担者を断定せず、判断理由と確認者を記録します。">
        <TextField name="item" label="項目" required placeholder="例: 居室クロス張替え" />
        <SelectField name="party" label="負担者" required options={opts(BURDEN_PARTY)} allowEmpty={false} />
        <MoneyField name="amount" label="金額" required />
        <TextArea name="reason" label="判断理由" required rows={3} className="sm:col-span-2" />
        <SelectField name="checkedBy" label="確認者" required options={staff} />
      </FormSection>
    </EditForm>
  );
}
