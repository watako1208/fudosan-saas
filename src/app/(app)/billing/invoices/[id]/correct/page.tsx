import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { companySettings } from "@/lib/server/lookups";
import { itemTypeList } from "@/lib/server/jobs/billing";
import { createAdjustment } from "@/lib/server/actions/billing";
import { C, Invoice } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { EditForm, FormSection, TextField, TextArea, CheckField } from "@/components/EditForm";
import { LineEditor } from "@/components/billing/LineEditor";
import { yen } from "@/lib/domain/money";
import { todayJst } from "@/lib/domain/dates";

export const metadata = { title: "請求の訂正" };

/** B16: 確定済み請求の訂正。元請求は変更せず、差額調整請求（下書き）を作成する */
export default async function CorrectInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("billing.confirm");
  const { id } = await params;
  const inv = await getDoc<Invoice>(ctx, C.invoices, id);
  if (!inv) notFound();
  if (inv.status !== "confirmed" || inv.kind === "cancellation") {
    return (
      <>
        <PageHeader title={`請求 ${inv.number} の訂正`} />
        <div className="card">
          <StateMessage kind="forbidden" message="確定済みの請求だけ訂正できます。下書きはそのまま編集してください。" action={<Link className="btn btn-secondary" href={`/billing/invoices/${id}`}>請求に戻る</Link>} />
        </div>
      </>
    );
  }
  const types = await itemTypeList(ctx);
  const settings = await companySettings(ctx.companyId);
  return (
    <>
      <PageHeader
        title={`請求 ${inv.number} の訂正（差額調整）`}
        sub="訂正後の正しい明細を入力してください。元の請求は変更せず、差額だけを持つ「差額調整」の請求（下書き）を作成し、元請求との関係を残します。"
      />
      <EditForm
        action={createAdjustment}
        initial={{ id: inv.id, period: todayJst().slice(0, 7), dueDate: inv.dueDate ?? "" }}
        cancelHref={`/billing/invoices/${id}`}
        buttons={[{ label: "差額調整を作成", intent: "adjust", primary: true }]}
        fieldLabels={{ reason: "訂正理由", period: "計上月", lines: "訂正後の明細" }}
      >
        <input type="hidden" name="id" value={inv.id} />
        <FormSection title="訂正の内容">
          <TextArea name="reason" label="訂正理由" required rows={2} className="sm:col-span-2" />
          <TextField name="period" label="差額調整の計上月（YYYY-MM）" required help="月次締め済みの月は指定できません" />
          <TextField name="dueDate" label="差額調整の支払期限" type="date" />
          {inv.paid > 0 && (
            <div className="sm:col-span-2 lg:col-span-3 rounded-md border border-warn/40 bg-warn-soft p-3 text-sm">
              <p className="font-semibold text-warn">この請求には {yen(inv.paid)} の入金配分があります（確認待ち）</p>
              <p>減額により入金額が請求額を上回る場合は、入金配分の取消または過入金の返金・次月充当の指定が必要です。</p>
              <CheckField name="acknowledge" label="入金配分への影響を確認しました" />
            </div>
          )}
        </FormSection>
        <FormSection title="訂正後の明細" desc={`元の請求額: ${yen(inv.total)}。費目・名称・税区分ごとに元の明細との差額を計算します。`}>
          <LineEditor
            itemTypes={types.map((t) => ({ code: t.code, name: t.name, tax: t.tax }))}
            initial={inv.lines.map((l) => ({ itemCode: l.itemCode, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, tax: l.tax }))}
            lineRounding={settings.lineRounding ?? "floor"}
            taxRounding={settings.taxRounding ?? "floor"}
          />
        </FormSection>
      </EditForm>
    </>
  );
}
