import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs, getMany } from "@/lib/server/repo";
import { staffNameMap } from "@/lib/server/lookups";
import { archivePayment, reverseAllocation, setDisposition } from "@/lib/server/actions/payments";
import { C, Allocation, Invoice, Payment } from "@/lib/types";
import { DetailHeader, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { AllocationEditor, OpenInvoice } from "@/components/billing/AllocationEditor";
import { InlineForm, Input, Select } from "@/components/billing/InlineForm";
import { PAYMENT_STATUS, PAYMENT_SOURCE, DISPOSITION } from "@/lib/labels-billing";
import { lbl, tone } from "@/lib/labels";
import { matchCandidates } from "@/lib/domain/rules";
import { allocatableOf } from "@/lib/domain/billing";
import { formatDateTimeJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("payment.read");
  const { id } = await params;
  const p = await getDoc<Payment>(ctx, C.payments, id);
  if (!p) notFound();
  const allocs = (await findDocs<Allocation>(ctx, C.allocations, [["paymentId", "==", id]], 500)).sort((a, b) => b.allocatedAt.localeCompare(a.allocatedAt));
  const invs = await getMany<Invoice>(ctx, C.invoices, allocs.map((a) => a.invoiceId));
  const names = await staffNameMap(ctx);
  const canWrite = ctx.caps.has("payment.write");
  const canConfirm = ctx.caps.has("payment.confirm");
  const allocatable = allocatableOf(p);
  const unallocatedRaw = p.amount - p.allocated;

  let open: OpenInvoice[] = [];
  let ambiguous = false;
  let openError: string | null = null;
  if (allocatable > 0 && canConfirm && !p.archived) {
    try {
      const list = (await findDocs<Invoice>(ctx, C.invoices, [["status", "==", "confirmed"], ["paidState", "in", ["none", "partial"]]], 1000)).filter((i) => !i.archived && i.total - i.paid > 0);
      const m = matchCandidates({ amount: p.amount - p.allocated, payerName: p.payerName }, list.map((i) => ({ id: i.id, remaining: i.total - i.paid, payerKana: i.payerKana ?? [] })));
      ambiguous = m.ambiguous;
      const cand = new Map(m.candidates.map((c) => [c.invoiceId, c]));
      open = list
        .map((i) => ({
          invoiceId: i.id, number: i.number, billToName: i.billToName, period: i.period, dueDate: i.dueDate, remaining: i.total - i.paid,
          score: cand.get(i.id)?.score ?? 0, reasons: cand.get(i.id)?.reasons ?? [],
        }))
        .sort((a, b) => b.score - a.score || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    } catch (e) {
      console.error("[payment.candidates]", (e as Error).message);
      openError = "配分先の請求を読み込めませんでした。";
    }
  }

  return (
    <>
      <DetailHeader
        back={{ href: "/billing/payments", label: "入金一覧" }}
        number={`入金日 ${p.date}`}
        title={`${p.payerName || "（名義なし）"} ${yen(p.amount)}`}
        badges={
          <>
            <Badge tone={tone(PAYMENT_STATUS, p.status)}>{lbl(PAYMENT_STATUS, p.status)}</Badge>
            <Badge>{lbl(PAYMENT_SOURCE, p.source)}</Badge>
            {p.archived && <Badge>アーカイブ</Badge>}
          </>
        }
        meta={
          <>
            <span>配分済み {yen(p.allocated)}</span>
            <span>未配分 {yen(unallocatedRaw)}</span>
            {p.unallocatedDisposition && <span>{lbl(DISPOSITION, p.unallocatedDisposition.kind)}指定 {yen(p.unallocatedDisposition.amount)}</span>}
          </>
        }
        actions={
          canWrite && (
            <>
              <Link href={`/billing/payments/${id}/edit`} className="btn btn-secondary">編集</Link>
              {p.allocated === 0 && (
                <ActionButton action={archivePayment} args={{ id }} label={p.archived ? "アーカイブ解除" : "誤登録としてアーカイブ"} prompt="理由を入力してください" variant="danger" />
              )}
            </>
          )
        }
      />
      <div className="space-y-4">
        <Card title="入金情報">
          <DL
            items={[
              ["入金日", p.date],
              ["金額", yen(p.amount)],
              ["名義", p.payerName],
              ["参照番号", p.reference],
              ["入金口座", p.account],
              ["取込元", p.source === "csv" && p.importBatchId ? <Link key="b" className="text-primary hover:underline" href={`/billing/payments/import/${p.importBatchId}`}>CSV取込み（{p.rowNo}行目）</Link> : lbl(PAYMENT_SOURCE, p.source)],
              ["配分済み", yen(p.allocated)],
              ["未配分残高", yen(unallocatedRaw)],
              ["配分可能額", yen(allocatable)],
            ]}
          />
        </Card>

        <Card title="配分済みの請求">
          {allocs.length === 0 ? (
            <StateMessage kind="empty" message="まだ請求へ配分していません" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>請求</th><th>請求先</th><th className="num">配分額</th><th>配分日時・担当</th><th>状態</th><th /></tr></thead>
                <tbody>
                  {allocs.map((a) => {
                    const inv = invs.get(a.invoiceId);
                    return (
                      <tr key={a.id}>
                        <td><Link className="text-primary hover:underline" href={`/billing/invoices/${a.invoiceId}`}>{inv?.number ?? "（請求）"}</Link></td>
                        <td>{inv?.billToName ?? "—"}</td>
                        <td className="num">{yen(a.amount)}</td>
                        <td>{formatDateTimeJst(a.allocatedAt)} {names.get(a.allocatedBy) ?? ""}</td>
                        <td>
                          {a.reversed ? <Badge>取消済み</Badge> : <Badge tone="ok">有効</Badge>}
                          {a.settlementId && <span className="ml-1"><Badge tone="info">精算済み</Badge></span>}
                          {a.reversed && a.reason && <div className="text-xs text-muted">理由: {a.reason}</div>}
                        </td>
                        <td>
                          {!a.reversed && canConfirm && (
                            <ActionButton
                              action={reverseAllocation}
                              args={{ id: a.id }}
                              label="配分を取消"
                              size="sm"
                              variant="danger"
                              prompt="配分を取り消す理由を入力してください"
                              disabled={!!a.settlementId}
                              disabledReason={a.settlementId ? "オーナー精算に含まれているため取り消せません" : undefined}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {allocatable > 0 && !p.archived && (
          <Card title="請求へ配分（消込）">
            {!canConfirm ? (
              <StateMessage kind="forbidden" message="入金配分の確定には「入金確定」の権限が必要です" />
            ) : openError ? (
              <StateMessage kind="error" message={openError} />
            ) : open.length === 0 ? (
              <StateMessage kind="empty" message="配分できる請求（確定済みで残額のある請求）がありません" />
            ) : (
              <AllocationEditor paymentId={id} allocatable={allocatable} invoices={open} ambiguous={ambiguous} />
            )}
          </Card>
        )}

        {(unallocatedRaw > 0 || p.unallocatedDisposition) && (
          <Card title="過入金・未配分残高の扱い">
            <p className="mb-3 text-sm">
              未配分残高 <b>{yen(unallocatedRaw)}</b> は残高として保持されます。
              「次月充当」は残高を残したまま翌月以降の請求へ配分する予定であることを記録し、「返金」は返金予定額を配分対象から外します（返金自体は外部で実施）。
            </p>
            {p.unallocatedDisposition && (
              <p className="mb-3 text-sm">
                現在の指定: <Badge tone="info">{lbl(DISPOSITION, p.unallocatedDisposition.kind)}</Badge> {yen(p.unallocatedDisposition.amount)}
                {p.unallocatedDisposition.note && `（${p.unallocatedDisposition.note}）`} — {names.get(p.unallocatedDisposition.by) ?? ""} {formatDateTimeJst(p.unallocatedDisposition.at)}
              </p>
            )}
            {canConfirm && (
              <InlineForm action={setDisposition} hidden={{ id, _version: p.version }} submitLabel="扱いを記録" successMessage="記録しました">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select
                    name="kind"
                    label="扱い"
                    required
                    defaultValue={p.unallocatedDisposition?.kind ?? "carry_forward"}
                    options={[
                      { value: "carry_forward", label: "次月充当（残高を保持）" },
                      { value: "refund", label: "返金" },
                      ...(p.unallocatedDisposition ? [{ value: "clear", label: "指定を解除" }] : []),
                    ]}
                  />
                  <Input name="amount" label="金額（円）" inputMode="numeric" defaultValue={p.unallocatedDisposition?.amount ?? unallocatedRaw} />
                  <Input name="note" label="メモ（返金方法・予定日など）" defaultValue={p.unallocatedDisposition?.note ?? ""} />
                </div>
              </InlineForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
