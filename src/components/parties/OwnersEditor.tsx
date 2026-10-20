"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { saveOwnerships, searchParties, type OwnershipRowInput } from "@/lib/server/actions/parties";
import { SearchSelect } from "./PartyPicker";
import type { ManagementFeeSetting } from "@/lib/domain/rules";

export interface OwnerRowInit {
  id: string;
  partyId: string;
  partyLabel: string;
  share: string;
  remitRatio: string | null;
  remainderReceiver: boolean;
  managementFee: ManagementFeeSetting | null;
  managedBy: string | null;
  from: string;
}

interface Row {
  key: string;
  id: string | null;
  partyId: string;
  partyLabel: string;
  from: string | null;
  share: string;
  remitRatio: string;
  remainderReceiver: boolean;
  removed: boolean;
  alsoLessor: boolean;
  feeOn: boolean;
  fee: { kind: "fixed" | "rate"; fixedAmount: string; rate: string; targetItemCodes: string[]; rounding: "floor" | "round" | "ceil"; taxRate: string };
}

const defaultFee = (codes: string[]): Row["fee"] => ({ kind: "rate", fixedAmount: "", rate: "0.05", targetItemCodes: codes, rounding: "floor", taxRate: "0.10" });

function toRow(o: OwnerRowInit, codes: string[]): Row {
  const f = o.managementFee;
  return {
    key: o.id, id: o.id, partyId: o.partyId, partyLabel: o.partyLabel, from: o.from, share: o.share, remitRatio: o.remitRatio ?? "",
    remainderReceiver: o.remainderReceiver, removed: false, alsoLessor: true, feeOn: !!f,
    fee: f ? { kind: f.kind, fixedAmount: f.fixedAmount === undefined ? "" : String(f.fixedAmount), rate: f.rate ?? "", targetItemCodes: f.targetItemCodes ?? [], rounding: f.rounding, taxRate: f.taxRate } : defaultFee(codes),
  };
}

/** 所有者・送金配分・管理料の編集。変更は適用開始日で新しい記録になり、過去の記録は終了日を設定して残す */
export function OwnersEditor({
  propertyId,
  initial,
  itemTypes,
  today,
}: {
  propertyId: string;
  initial: OwnerRowInit[];
  itemTypes: { code: string; name: string; target: boolean }[];
  today: string;
}) {
  const router = useRouter();
  const defaultCodes = itemTypes.filter((i) => i.target).map((i) => i.code);
  const [rows, setRows] = useState<Row[]>(() => initial.map((o) => toRow(o, defaultCodes)));
  const [eff, setEff] = useState(today);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const rid = useRef(crypto.randomUUID());

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const upd = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const updFee = (key: string, patch: Partial<Row["fee"]>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, fee: { ...r.fee, ...patch } } : r)));
    setDirty(true);
  };
  const live = rows.filter((r) => !r.removed);
  const ratioSum = (() => {
    try {
      const withR = live.filter((r) => r.remitRatio.trim());
      if (!withR.length) return null;
      return withR.reduce((s, r) => {
        const t = r.remitRatio.trim();
        const m = /^(\d+)\/(\d+)$/.exec(t);
        return s.add(m ? new Decimal(m[1]).div(m[2]) : new Decimal(t));
      }, new Decimal(0));
    } catch {
      return null;
    }
  })();

  const save = async () => {
    setBusy(true);
    setErrs([]);
    const payload: OwnershipRowInput[] = rows
      .filter((r) => r.id || !r.removed)
      .map((r) => ({
        id: r.id,
        partyId: r.partyId,
        share: r.share,
        remitRatio: r.remitRatio.trim() || null,
        remainderReceiver: live.length === 1 ? true : r.remainderReceiver,
        managementFee: r.feeOn
          ? {
              kind: r.fee.kind,
              fixedAmount: r.fee.kind === "fixed" ? (r.fee.fixedAmount === "" ? (undefined as unknown as number) : Number(r.fee.fixedAmount.replace(/[,円]/g, ""))) : undefined,
              rate: r.fee.kind === "rate" ? r.fee.rate : undefined,
              targetItemCodes: r.fee.targetItemCodes,
              rounding: r.fee.rounding,
              taxRate: r.fee.taxRate,
            }
          : null,
        managedBy: null,
        removed: r.removed,
        alsoLessor: r.alsoLessor,
      }));
    try {
      const res = await saveOwnerships(propertyId, { effectiveDate: eff, rows: payload, _requestId: rid.current });
      if (res.ok) {
        rid.current = crypto.randomUUID();
        setDirty(false);
        router.push(res.data.redirect);
      } else setErrs(res.errors?.length ? res.errors : [res.error]);
    } catch {
      setErrs(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {errs.length > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <p className="font-semibold">保存できませんでした</p>
          <ul className="mt-1 list-disc pl-5">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      <div className="card card-pad flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="label">適用開始日<span className="ml-1 text-xs text-danger">必須</span></span>
          <input type="date" className="input" value={eff} onChange={(e) => { setEff(e.target.value); setDirty(true); }} />
        </label>
        <p className="help max-w-xl">
          変更・削除した所有者の記録は適用開始日の前日で終了し、新しい条件は適用開始日からの新しい記録として保存します（過去の記録は上書きしません）。
          送金配分率は所有持分とは別の設定で、設定する場合は合計100%にします。
        </p>
      </div>

      {rows.map((r, idx) => (
        <section key={r.key} className={`card ${r.removed ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-base">
              {idx + 1}. {r.partyLabel}
              {r.id ? <span className="ml-2 text-xs font-normal text-muted">{r.from}〜 適用中</span> : <span className="ml-2 text-xs font-normal text-primary">新規追加</span>}
            </h2>
            {r.id ? (
              <button type="button" className={`btn btn-sm ${r.removed ? "btn-secondary" : "btn-danger"}`} onClick={() => upd(r.key, { removed: !r.removed })}>
                {r.removed ? "終了を取り消す" : "所有者から外す（終了日を設定）"}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((x) => x.key !== r.key)); setDirty(true); }}>追加を取り消す</button>
            )}
          </div>
          {!r.removed && (
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm">
                <span className="label">持分<span className="ml-1 text-xs text-danger">必須</span></span>
                <input className="input" value={r.share} onChange={(e) => upd(r.key, { share: e.target.value })} placeholder="例: 1/2 または 0.5" />
              </label>
              <label className="text-sm">
                <span className="label">送金配分率</span>
                <input className="input" inputMode="decimal" value={r.remitRatio} onChange={(e) => upd(r.key, { remitRatio: e.target.value })} placeholder="例: 0.5（空欄=未設定）" />
              </label>
              <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                <input type="radio" name="remainder" checked={live.length === 1 || r.remainderReceiver} onChange={() => { setRows(rows.map((x) => ({ ...x, remainderReceiver: x.key === r.key }))); setDirty(true); }} />
                端数の配分先にする
              </label>
              {!r.id && (
                <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                  <input type="checkbox" checked={r.alsoLessor} onChange={(e) => upd(r.key, { alsoLessor: e.target.checked })} />
                  貸主の役割も登録する
                </label>
              )}
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={r.feeOn} onChange={(e) => upd(r.key, { feeOn: e.target.checked })} />
                  管理料を設定する
                </label>
                {r.feeOn && (
                  <div className="mt-2 grid grid-cols-1 gap-3 rounded-md border border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-sm">
                      <span className="label">方式</span>
                      <select className="input" value={r.fee.kind} onChange={(e) => updFee(r.key, { kind: e.target.value as "fixed" | "rate" })}>
                        <option value="rate">料率（対象費目 × 率）</option>
                        <option value="fixed">定額</option>
                      </select>
                    </label>
                    {r.fee.kind === "rate" ? (
                      <label className="text-sm">
                        <span className="label">料率</span>
                        <input className="input" inputMode="decimal" value={r.fee.rate} onChange={(e) => updFee(r.key, { rate: e.target.value })} placeholder="5% は 0.05" />
                      </label>
                    ) : (
                      <label className="text-sm">
                        <span className="label">定額（円・月額）</span>
                        <input className="input" inputMode="numeric" value={r.fee.fixedAmount} onChange={(e) => updFee(r.key, { fixedAmount: e.target.value })} />
                      </label>
                    )}
                    <label className="text-sm">
                      <span className="label">管理料の消費税率</span>
                      <input className="input" inputMode="decimal" value={r.fee.taxRate} onChange={(e) => updFee(r.key, { taxRate: e.target.value })} placeholder="0.10" />
                    </label>
                    <label className="text-sm">
                      <span className="label">端数処理</span>
                      <select className="input" value={r.fee.rounding} onChange={(e) => updFee(r.key, { rounding: e.target.value as Row["fee"]["rounding"] })}>
                        <option value="floor">切捨て</option>
                        <option value="round">四捨五入</option>
                        <option value="ceil">切上げ</option>
                      </select>
                    </label>
                    <fieldset className="sm:col-span-2 lg:col-span-4">
                      <legend className="label">管理料の対象費目（賃料のみか、共益費なども含むかを明示）</legend>
                      <div className="flex flex-wrap gap-x-4">
                        {itemTypes.map((it) => (
                          <label key={it.code} className="flex min-h-10 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={r.fee.targetItemCodes.includes(it.code)}
                              onChange={(e) =>
                                updFee(r.key, {
                                  targetItemCodes: e.target.checked ? [...r.fee.targetItemCodes, it.code] : r.fee.targetItemCodes.filter((c) => c !== it.code),
                                })
                              }
                            />
                            {it.name}
                          </label>
                        ))}
                        {itemTypes.length === 0 && <span className="text-sm text-muted">費目が設定されていません（設定画面で費目を登録してください）</span>}
                      </div>
                    </fieldset>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      ))}

      <div className="card card-pad space-y-2">
        {adding ? (
          <>
            <span className="label">追加する所有者を検索</span>
            <SearchSelect
              autoFocus
              search={(q) => searchParties({ q })}
              onPick={(it) => {
                if (rows.some((r) => r.partyId === it.id && !r.removed)) {
                  setErrs([`${it.label} は既に所有者として登録されています`]);
                  return;
                }
                setRows([
                  ...rows,
                  { key: `new-${Date.now()}`, id: null, partyId: it.id, partyLabel: it.label, from: null, share: live.length ? "" : "1", remitRatio: "", remainderReceiver: live.length === 0, removed: false, alsoLessor: true, feeOn: false, fee: defaultFee(defaultCodes) },
                ]);
                setDirty(true);
                setAdding(false);
              }}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>閉じる</button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>＋ 所有者を追加（所有者の変更は「外す」＋「追加」）</button>
        )}
        <p className="help">顧客に登録されていない所有者は、先に顧客として登録してください。</p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm">
            <span className={`font-semibold ${dirty ? "text-warn" : "text-muted"}`}>{busy ? "保存中…" : dirty ? "未保存" : "変更なし"}</span>
            <span className="ml-3 text-muted">
              有効な所有者 {live.length}名
              {ratioSum && <> ／ 送金配分率の合計 <b className={ratioSum.eq(1) ? "text-ok" : "text-danger"}>{ratioSum.mul(100).toDecimalPlaces(4).toString()}%</b></>}
            </span>
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => { if (!dirty || window.confirm("保存していない変更があります。破棄しますか？")) router.push(`/properties/${propertyId}`); }}>キャンセル</button>
            <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
