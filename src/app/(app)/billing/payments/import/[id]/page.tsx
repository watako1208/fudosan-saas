import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { C } from "@/lib/types";
import { resetPaymentImport, commitPaymentImport, type PaymentImportBatch } from "@/lib/server/actions/payments";
import { DetailHeader, Card, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { ImportMapping, ImportPreview, PreviewRow } from "@/components/billing/ImportSteps";
import { IMPORT_STATUS } from "@/lib/labels-billing";
import { lbl, tone } from "@/lib/labels";
import { formatDateTimeJst } from "@/lib/domain/dates";

const STEPS = ["アップロード", "文字コード・列対応", "検証・取込予定", "確定", "結果確認"];

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("payment.read");
  const { id } = await params;
  const b = await getDoc<PaymentImportBatch>(ctx, C.importBatches, id);
  if (!b || b.kind !== "payments") notFound();
  const canWrite = ctx.caps.has("payment.write");
  const step = b.status === "committed" ? 4 : b.status === "validated" || b.status === "failed" ? 2 : 1;
  const valid = new Map((b.validated ?? []).map((v) => [v.rowNo, v]));
  const rows: PreviewRow[] = b.rows.map((r) => {
    const v = valid.get(r.rowNo);
    return {
      rowNo: r.rowNo,
      date: v?.date ?? null,
      amount: v?.amount ?? null,
      payerName: v?.payerName ?? "",
      reference: v?.reference ?? "",
      error: r.error,
      action: r.action,
      duplicateOf: r.duplicateOf ?? [],
      sameFile: b.sameFileDuplicates?.[String(r.rowNo)] ?? [],
    };
  });

  return (
    <>
      <DetailHeader
        back={{ href: "/billing/payments/import", label: "入金CSV取込み" }}
        number={`取込番号 ${b.id}`}
        title={b.fileName}
        badges={<Badge tone={tone(IMPORT_STATUS, b.status)}>{lbl(IMPORT_STATUS, b.status)}</Badge>}
        meta={
          <>
            <span>{b.rows.length}行</span>
            <span>文字コード: {b.encoding === "shift_jis" ? "Shift_JIS" : "UTF-8"}</span>
            <span>登録: {formatDateTimeJst(b.createdAt)}</span>
            {b.committedAt && <span>確定: {formatDateTimeJst(b.committedAt)}</span>}
          </>
        }
        actions={
          canWrite && (b.status === "validated" || b.status === "failed") && (
            <ActionButton action={resetPaymentImport} args={{ id }} label="列対応に戻る" />
          )
        }
      />
      <ol className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="取込みの手順">
        {STEPS.map((s, i) => (
          <li key={s} className={`rounded border px-2 py-1 ${i === step ? "border-primary bg-primary-soft font-semibold text-primary" : i < step ? "border-line text-ink" : "border-line text-muted"}`}>
            {i + 1}. {s}{i < step ? "（済）" : ""}
          </li>
        ))}
      </ol>

      {(b.status === "uploaded" || b.status === "mapped") &&
        (canWrite ? (
          <Card title="文字コード・列対応">
            <ImportMapping batchId={id} encoding={b.encoding} headers={b.headers} sample={b.rows.slice(0, 5).map((r) => r.raw)} mapping={b.mapping ?? {}} />
          </Card>
        ) : (
          <Card><p className="text-muted">列対応には入金登録の権限が必要です。</p></Card>
        ))}

      {(b.status === "validated" || b.status === "failed") && (
        <Card title="取込予定の確認">
          {b.status === "failed" && (
            <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger" role="alert">
              取込みの途中で失敗しました。もう一度「取込みを確定」を押すと続きから登録します（登録済みの行は二重登録されません）。
            </div>
          )}
          {canWrite ? <ImportPreview batchId={id} rows={rows} committed={false} /> : <p className="text-muted">取込みの確定には入金登録の権限が必要です。</p>}
        </Card>
      )}

      {b.status === "committed" && (
        <div className="space-y-4">
          <Card
            title="取込み結果"
            actions={canWrite && <ActionButton action={commitPaymentImport} args={{ id }} label="同じ取込みを再試行" confirm="同じ取込処理を再試行します。登録済みの行は二重登録されません。" />}
          >
            <p>
              新規登録 <b>{b.results?.created ?? 0}</b>行 ／ 登録済み（再試行で重複しなかった行） <b>{b.results?.existed ?? 0}</b>行 ／ 取込対象外 <b>{b.results?.skipped ?? 0}</b>行
            </p>
            <p className="mt-2 text-sm"><Link className="text-primary hover:underline" href="/billing/payments?source=csv">入金一覧で配分（消込）へ進む</Link></p>
          </Card>
          <Card title="行ごとの結果">
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>行</th><th>入金日</th><th className="num">金額</th><th>名義</th><th>結果</th></tr></thead>
                <tbody>
                  {b.rows.map((r) => {
                    const v = valid.get(r.rowNo);
                    return (
                      <tr key={r.rowNo}>
                        <td>{r.rowNo}</td>
                        <td>{v?.date ?? "—"}</td>
                        <td className="num">{v ? `${v.amount.toLocaleString()}円` : "—"}</td>
                        <td>{v?.payerName ?? "—"}</td>
                        <td>
                          {r.resultId ? (
                            <Link className="text-primary hover:underline" href={`/billing/payments/${r.resultId}`}>登録済み（入金を表示）</Link>
                          ) : r.error ? (
                            <span className="text-danger">エラー: {r.error}</span>
                          ) : (
                            <span className="text-muted">取込まない{r.duplicateOf?.length ? "（重複候補）" : ""}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
