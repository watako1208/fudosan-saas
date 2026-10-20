"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettlementInputs } from "@/lib/server/actions/settlements";

interface Expense {
  name: string;
  amount: string;
  repairId: string | null;
}

/** 精算の立替費用・繰越の入力（計算中のみ）。修繕の貸主負担額を候補から選んで追加できる */
export function SettlementInputs({
  id,
  version,
  expenses: initial,
  carryIn,
  note,
  candidates,
  allowNegative,
}: {
  id: string;
  version: number;
  expenses: { name: string; amount: number; repairId: string | null }[];
  carryIn: number;
  note: string | null;
  candidates: { repairId: string; name: string; amount: number; completedAt: string | null }[];
  allowNegative: boolean;
}) {
  const router = useRouter();
  const rid = useRef<string>(crypto.randomUUID());
  const [rows, setRows] = useState<Expense[]>(initial.map((e) => ({ name: e.name, amount: String(e.amount), repairId: e.repairId })));
  const [carry, setCarry] = useState(String(carryIn));
  const [memo, setMemo] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [state, setState] = useState<"clean" | "dirty" | "saved">("clean");
  const used = new Set(rows.map((r) => r.repairId).filter(Boolean));
  const set = (i: number, p: Partial<Expense>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
    setState("dirty");
  };
  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
          <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      <div>
        <p className="label">立替費用（オーナー負担の控除）{allowNegative && <span className="ml-1 text-xs text-muted">訂正精算ではマイナス（戻し）も入力できます</span>}</p>
        <table className="table">
          <thead><tr><th>名称</th><th className="w-48">金額（円）</th><th>関連修繕</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="text-muted">立替費用はありません</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input className="input" aria-label={`${i + 1}行目の名称`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input className="input" inputMode="numeric" aria-label={`${i + 1}行目の金額`} value={r.amount} onChange={(e) => set(i, { amount: e.target.value })} /></td>
                <td>{r.repairId ? <a className="text-primary hover:underline" href={`/support/repairs/${r.repairId}`}>修繕を表示</a> : "—"}</td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setState("dirty"); }}>削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => { setRows([...rows, { name: "", amount: "", repairId: null }]); setState("dirty"); }}>＋ 費用を追加</button>
      </div>
      {candidates.length > 0 && (
        <div>
          <p className="label">修繕の貸主負担（候補）</p>
          <p className="help mb-2">完了した修繕のうち、承認済み見積の貸主負担額です。内容を確認して追加してください（他の精算で使用済みのものは表示しません）。</p>
          <ul className="space-y-1">
            {candidates.map((c) => (
              <li key={c.repairId} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{c.name}（{c.amount.toLocaleString()}円{c.completedAt ? `・完了 ${c.completedAt.slice(0, 10)}` : ""}）</span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={used.has(c.repairId)}
                  onClick={() => { setRows([...rows, { name: c.name, amount: String(c.amount), repairId: c.repairId }]); setState("dirty"); }}
                >
                  {used.has(c.repairId) ? "追加済み" : "追加"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="carryIn">前回繰越（円）</label>
          <input id="carryIn" className="input" inputMode="numeric" value={carry} onChange={(e) => { setCarry(e.target.value); setState("dirty"); }} />
          <p className="help">前回精算で費用が上回った場合のマイナス繰越など。次回調整もここで行います。</p>
        </div>
        <div>
          <label className="label" htmlFor="memo">メモ</label>
          <input id="memo" className="input" value={memo} onChange={(e) => { setMemo(e.target.value); setState("dirty"); }} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErrors([]);
            try {
              const r = await saveSettlementInputs({ id, _version: version, expenses: JSON.stringify(rows), carryIn: carry, note: memo, _requestId: rid.current });
              if (!r.ok) setErrors(r.code === "conflict" ? ["他の利用者が先に更新しました。画面を読み直してください。"] : r.errors?.length ? r.errors : [r.error]);
              else {
                rid.current = crypto.randomUUID();
                setState("saved");
                router.refresh();
              }
            } catch {
              setErrors(["通信に失敗しました。入力内容は保持されています。再試行してください。"]);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "計算中…" : "保存して再計算"}
        </button>
        <span className={`text-sm font-semibold ${state === "dirty" ? "text-warn" : state === "saved" ? "text-ok" : "text-muted"}`} aria-live="polite">
          {state === "dirty" ? "未保存" : state === "saved" ? "保存済み" : "変更なし"}
        </span>
      </div>
    </div>
  );
}
