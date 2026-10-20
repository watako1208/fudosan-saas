import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { listDocs } from "@/lib/server/repo";
import { staffNameMap } from "@/lib/server/lookups";
import { C } from "@/lib/types";
import type { PaymentImportBatch } from "@/lib/server/actions/payments";
import { PageHeader, Card, Badge, StateMessage } from "@/components/ui";
import { BillingNav } from "@/components/billing/BillingNav";
import { ImportUpload } from "@/components/billing/ImportSteps";
import { IMPORT_STATUS } from "@/lib/labels-billing";
import { lbl, tone } from "@/lib/labels";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "入金CSV取込み" };

export default async function PaymentImportPage() {
  const ctx = await requireStaffPage("payment.read");
  let batches: PaymentImportBatch[] = [];
  let error: string | null = null;
  try {
    batches = (await listDocs<PaymentImportBatch>(ctx, C.importBatches, { where: [["kind", "==", "payments"]], orderBy: "createdAt", dir: "desc", pageSize: 50 })).items;
  } catch (e) {
    console.error("[import.list]", (e as Error).message);
    error = "取込み履歴を読み込めませんでした。";
  }
  const names = await staffNameMap(ctx);
  return (
    <>
      <PageHeader title="入金CSV取込み" sub="アップロード → 文字コード確認・列対応 → 検証 → 取込予定の確認 → 確定 → 結果確認 の順に進みます。銀行への自動接続は行いません。" />
      <BillingNav current="import" isAdmin={ctx.caps.has("settings.manage")} />
      {ctx.caps.has("payment.write") && (
        <Card title="CSVをアップロード">
          <ImportUpload />
        </Card>
      )}
      <div className="mt-4">
        <Card title="取込み履歴">
          {error ? (
            <StateMessage kind="error" message={error} />
          ) : batches.length === 0 ? (
            <StateMessage kind="empty" message="まだ取込みはありません" />
          ) : (
            <table className="table">
              <thead><tr><th>ファイル</th><th>取込番号</th><th>行数</th><th>状態</th><th>結果</th><th>登録</th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td><Link className="text-primary hover:underline" href={`/billing/payments/import/${b.id}`}>{b.fileName}</Link></td>
                    <td className="text-xs text-muted">{b.id}</td>
                    <td>{b.rows?.length ?? 0}</td>
                    <td><Badge tone={tone(IMPORT_STATUS, b.status)}>{lbl(IMPORT_STATUS, b.status)}</Badge></td>
                    <td>{b.results ? `登録 ${b.results.created}・登録済み ${b.results.existed}・対象外 ${b.results.skipped}` : "—"}</td>
                    <td>{formatDateTimeJst(b.createdAt)} {names.get(b.createdBy) ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
