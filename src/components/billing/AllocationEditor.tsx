"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { allocatePayment } from "@/lib/server/actions/payments";

export interface OpenInvoice {
  invoiceId: string;
  number: string;
  billToName: string;
  period: string | null;
  dueDate: string | null;
  remaining: number;
  score: number;
  reasons: string[];
}

/**
 * 入金配分（消込）の編集。1つの入金を複数の請求へ配分できる（B13/B14）。
 * 照合候補は理由とともに表示するが、自動では配分しない（B15）。確定は担当者が行う。
 */
export function AllocationEditor({ paymentId, allocatable, invoices, ambiguous }: { paymentId: string; allocatable: number; invoices: OpenInvoice[]; ambiguous: boolean }) {
  const router = useRouter();
  const rid = useRef<string>(crypto.randomUUID());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const parse = (s: string) => {
    const n = Number((s ?? "").normalize("NFKC").replace(/[,¥円\s]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  const sum = Object.values(amounts).reduce((s, v) => s + (v.trim() ? parse(v) || 0 : 0), 0);
  const left = allocatable - sum;
  const shown = useMemo(() => {
    const f = filter.normalize("NFKC").trim().toLowerCase();
    const list = f ? invoices.filter((i) => `${i.number} ${i.billToName} ${i.period ?? ""}`.toLowerCase().includes(f)) : invoices;
    return list.slice(0, 200);
  }, [filter, invoices]);
  const candidates = invoices.filter((i) => i.score > 0);

  const submit = async () => {
    const items = Object.entries(amounts)
      .filter(([, v]) => v.trim())
      .map(([invoiceId, v]) => ({ invoiceId, amount: parse(v) }));
    if (!items.length) return setErrors(["配分する請求の金額を入力してください"]);
    if (items.some((i) => !Number.isInteger(i.amount) || i.amount <= 0)) return setErrors(["配分額は1円以上の整数で入力してください"]);
    if (sum > allocatable) return setErrors([`配分額の合計が配分可能額（${allocatable.toLocaleString()}円）を超えています`]);
    if (!window.confirm(`${items.length}件の請求へ合計 ${sum.toLocaleString()}円を配分（消込）します。よろしいですか？`)) return;
    setBusy(true);
    setErrors([]);
    try {
      const r = await allocatePayment({ paymentId, items: JSON.stringify(items), _requestId: rid.current });
      if (!r.ok) setErrors(r.errors?.length ? r.errors : [r.error]);
      else {
        rid.current = crypto.randomUUID();
        setAmounts({});
        router.refresh();
      }
    } catch {
      setErrors(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {ambiguous && (
        <div className="mb-3 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm" role="status">
          <p className="font-semibold text-warn">確認待ち: 同じ条件で一致する請求が複数あります</p>
          <p>名義・金額が同程度に一致する候補が複数あるため、自動では選びません。契約・対象月を確認して配分先を指定してください。</p>
        </div>
      )}
      {candidates.length === 0 && <p className="mb-3 text-sm text-muted">名義・金額が一致する照合候補はありません。下の一覧から請求を探して配分してください。</p>}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input className="input max-w-sm" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="請求番号・請求先・対象月で絞込み" aria-label="請求を絞込み" />
        <span className="text-sm text-muted">未入金・一部入金の確定済み請求 {invoices.length}件</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>請求</th><th>請求先</th><th>対象月</th><th>期限</th><th className="num">残額</th><th>照合候補の理由</th><th className="w-44">配分額（円）</th></tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.invoiceId} className={i.score > 0 ? "bg-primary-soft/40" : ""}>
                <td><a className="text-primary hover:underline" href={`/billing/invoices/${i.invoiceId}`} target="_blank" rel="noreferrer">{i.number}</a></td>
                <td>{i.billToName}</td>
                <td>{i.period ?? "—"}</td>
                <td>{i.dueDate ?? "—"}</td>
                <td className="num">{i.remaining.toLocaleString()}円</td>
                <td className="text-sm">{i.reasons.length ? i.reasons.join("・") : "—"}</td>
                <td>
                  <div className="flex gap-1">
                    <input
                      className="input"
                      inputMode="numeric"
                      aria-label={`${i.number}への配分額`}
                      value={amounts[i.invoiceId] ?? ""}
                      onChange={(e) => setAmounts({ ...amounts, [i.invoiceId]: e.target.value })}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="残額または配分可能額の少ない方を入力"
                      onClick={() => {
                        const cur = amounts[i.invoiceId]?.trim() ? parse(amounts[i.invoiceId]) || 0 : 0;
                        const v = Math.max(Math.min(i.remaining, left + cur), 0);
                        setAmounts({ ...amounts, [i.invoiceId]: v ? String(v) : "" });
                      }}
                    >
                      充当
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors.length > 0 && (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <ul className="list-disc pl-5">{errors.map((e, k) => <li key={k}>{e}</li>)}</ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          配分可能額 <b>{allocatable.toLocaleString()}円</b> ／ 入力合計 <b>{sum.toLocaleString()}円</b> ／ 配分後の未配分 <b className={left < 0 ? "text-danger" : ""}>{left.toLocaleString()}円</b>
        </p>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || sum <= 0}>{busy ? "処理中…" : "配分を確定"}</button>
      </div>
    </div>
  );
}
