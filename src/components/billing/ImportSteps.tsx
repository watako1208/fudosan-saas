"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadPaymentCsv, mapPaymentImport, commitPaymentImport } from "@/lib/server/actions/payments";

function Errors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
      <ul className="list-disc pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
    </div>
  );
}

/** 手順1: アップロード */
export function ImportUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const f = fd.get("file");
        if (!f || typeof f === "string" || !f.size) return setErrors(["CSVファイルを選択してください"]);
        setBusy(true);
        setErrors([]);
        try {
          const r = await uploadPaymentCsv(fd);
          if (!r.ok) setErrors(r.errors?.length ? r.errors : [r.error]);
          else router.push(r.data.redirect);
        } catch {
          setErrors(["アップロードに失敗しました。ファイルサイズ（500KBまで）を確認して再試行してください。"]);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Errors errors={errors} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="csv-file">入金明細CSV<span className="ml-1 text-xs text-danger">必須</span></label>
          <input id="csv-file" name="file" type="file" accept=".csv,text/csv" className="input" />
          <p className="help">1行目は見出し行としてください。500KB・2,000行まで。</p>
        </div>
        <div>
          <label className="label" htmlFor="csv-enc">文字コード</label>
          <select id="csv-enc" name="encoding" className="input" defaultValue="">
            <option value="">自動判定（UTF-8 / Shift_JIS）</option>
            <option value="utf-8">UTF-8</option>
            <option value="shift_jis">Shift_JIS</option>
          </select>
          <p className="help">文字化けしている場合は次の画面で変更できます。</p>
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "アップロード中…" : "アップロードして列対応へ"}</button>
    </form>
  );
}

/** 手順2: 文字コード確認・列対応 */
export function ImportMapping({
  batchId,
  encoding,
  headers,
  sample,
  mapping,
}: {
  batchId: string;
  encoding: string;
  headers: string[];
  sample: string[][];
  mapping: Record<string, number>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const FIELDS: { key: string; label: string; required?: boolean }[] = [
    { key: "date", label: "入金日", required: true },
    { key: "amount", label: "金額", required: true },
    { key: "payer", label: "名義" },
    { key: "reference", label: "参照番号" },
    { key: "account", label: "口座識別" },
  ];
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const v: Record<string, unknown> = { id: batchId };
        for (const [k, x] of fd.entries()) v[k] = x;
        setBusy(true);
        setErrors([]);
        try {
          const r = await mapPaymentImport(v);
          if (!r.ok) setErrors(r.errors?.length ? r.errors : [r.error]);
          else router.refresh();
        } catch {
          setErrors(["通信に失敗しました。再試行してください。"]);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Errors errors={errors} />
      <div className="max-w-xs">
        <label className="label" htmlFor="map-enc">文字コード（判定結果: {encoding === "shift_jis" ? "Shift_JIS" : "UTF-8"}）</label>
        <select id="map-enc" name="encoding" className="input" defaultValue={encoding}>
          <option value="utf-8">UTF-8</option>
          <option value="shift_jis">Shift_JIS</option>
        </select>
        <p className="help">下の見本が文字化けしている場合は変更して「検証」を押すと、原本から読み直します。</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label" htmlFor={`map-${f.key}`}>
              {f.label}
              {f.required ? <span className="ml-1 text-xs text-danger">必須</span> : <span className="ml-1 text-xs text-muted">任意</span>}
            </label>
            <select id={`map-${f.key}`} name={f.key} className="input" defaultValue={mapping[f.key] !== undefined ? String(mapping[f.key]) : ""}>
              <option value="">（使わない）</option>
              {headers.map((h, i) => (
                <option key={i} value={String(i)}>{i + 1}列目: {h || "（見出しなし）"}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div>
        <p className="label">見本（先頭5行）</p>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr>{headers.map((h, i) => <th key={i}>{i + 1}: {h}</th>)}</tr></thead>
            <tbody>
              {sample.map((r, i) => (
                <tr key={i}>{headers.map((_, j) => <td key={j}>{r[j] ?? ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "検証中…" : "検証して取込予定を表示"}</button>
    </form>
  );
}

export interface PreviewRow {
  rowNo: number;
  date: string | null;
  amount: number | null;
  payerName: string;
  reference: string;
  error: string | null;
  action: "create" | "update" | "skip";
  duplicateOf: string[];
  sameFile: number[];
}

/** 手順3: 取込予定の確認（行ごとに 取込む/取込まない を指定）→ 確定 */
export function ImportPreview({ batchId, rows, committed }: { batchId: string; rows: PreviewRow[]; committed: boolean }) {
  const router = useRouter();
  const rid = useRef<string>(crypto.randomUUID());
  const [actions, setActions] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [String(r.rowNo), r.action === "create" ? "create" : "skip"])));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const createCount = rows.filter((r) => !r.error && actions[String(r.rowNo)] === "create").length;
  const dupCount = rows.filter((r) => r.duplicateOf.length || r.sameFile.length).length;
  return (
    <div>
      <Errors errors={errors} />
      <p className="mb-3 text-sm">
        全 {rows.length}行 ／ 取込む <b>{createCount}</b>行 ／ エラー <b>{rows.filter((r) => r.error).length}</b>行 ／ 重複候補 <b>{dupCount}</b>行。
        重複候補は内容（入金日・金額・名義・参照番号）が一致するだけで、同日同額の正当な入金の可能性があります。行ごとに判断してください（削除はしません）。
      </p>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>行</th><th>入金日</th><th className="num">金額</th><th>名義</th><th>参照番号</th><th>確認事項</th><th>取込み</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNo}>
                <td>{r.rowNo}</td>
                <td>{r.date ?? "—"}</td>
                <td className="num">{r.amount !== null ? `${r.amount.toLocaleString()}円` : "—"}</td>
                <td>{r.payerName || "—"}</td>
                <td>{r.reference || "—"}</td>
                <td className="text-sm">
                  {r.error && <span className="text-danger">{r.error}</span>}
                  {r.duplicateOf.length > 0 && (
                    <div className="text-warn">
                      登録済みの入金と内容が一致:{" "}
                      {r.duplicateOf.slice(0, 5).map((d) => (
                        <a key={d} className="mr-1 underline" href={`/billing/payments/${d}`} target="_blank" rel="noreferrer">入金を表示</a>
                      ))}
                    </div>
                  )}
                  {r.sameFile.length > 0 && <div className="text-muted">同じファイルの {r.sameFile.join("・")}行目と内容が一致</div>}
                  {!r.error && !r.duplicateOf.length && !r.sameFile.length && "—"}
                </td>
                <td>
                  {r.error ? (
                    <span className="text-sm text-muted">取込不可</span>
                  ) : (
                    <select
                      className="input !w-auto"
                      aria-label={`${r.rowNo}行目の取込み`}
                      disabled={committed}
                      value={actions[String(r.rowNo)]}
                      onChange={(e) => setActions({ ...actions, [String(r.rowNo)]: e.target.value })}
                    >
                      <option value="create">取込む（新規）</option>
                      <option value="skip">取込まない</option>
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!committed && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || createCount === 0}
            onClick={async () => {
              if (!window.confirm(`${createCount}行を入金として登録します。よろしいですか？（同じ取込処理を再実行しても二重登録しません）`)) return;
              setBusy(true);
              setErrors([]);
              try {
                const r = await commitPaymentImport({ id: batchId, actions: JSON.stringify(actions), _requestId: rid.current });
                if (!r.ok) setErrors(r.errors?.length ? r.errors : [r.error]);
                router.refresh();
              } catch {
                setErrors(["通信に失敗しました。もう一度「取込みを確定」を押してください（登録済みの行は二重登録されません）。"]);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "取込み中…" : `取込みを確定（${createCount}行）`}
          </button>
        </div>
      )}
    </div>
  );
}
