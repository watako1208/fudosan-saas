import { requireStaffPage } from "@/lib/server/session";
import { PageHeader } from "@/components/ui";
import { PaymentForm } from "@/components/billing/PaymentForm";
import { todayJst } from "@/lib/domain/dates";

export const metadata = { title: "入金の手入力" };

export default async function NewPaymentPage() {
  await requireStaffPage("payment.write");
  return (
    <>
      <PageHeader title="入金の手入力" sub="通帳・入金明細を見て入力します。登録後に請求へ配分（消込）します。" />
      <PaymentForm initial={{ date: todayJst() }} cancelHref="/billing/payments" />
    </>
  );
}
