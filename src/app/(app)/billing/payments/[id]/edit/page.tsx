import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { C, Payment } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { PaymentForm } from "@/components/billing/PaymentForm";

export const metadata = { title: "入金の編集" };

export default async function EditPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("payment.write");
  const { id } = await params;
  const p = await getDoc<Payment>(ctx, C.payments, id);
  if (!p) notFound();
  return (
    <>
      <PageHeader title="入金の編集" sub={p.allocated > 0 ? "配分済みのため、入金日・金額は変更できません（名義・参照番号・口座のみ）" : undefined} />
      <PaymentForm
        initial={{ id: p.id, date: p.date, amount: p.amount, payerName: p.payerName, reference: p.reference ?? "", account: p.account ?? "" }}
        version={p.version}
        cancelHref={`/billing/payments/${id}`}
      />
    </>
  );
}
