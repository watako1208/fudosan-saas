import { requireStaffPage } from "@/lib/server/session";
import { staffOptions } from "@/lib/server/lookups";
import { createInquiry } from "@/lib/server/actions/support";
import { PageHeader } from "@/components/ui";
import { InquiryForm } from "@/components/support/InquiryForm";

export const metadata = { title: "問い合わせ登録" };

function nowLocalJst(): string {
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
  return p.replace(" ", "T");
}

export default async function NewInquiryPage() {
  const ctx = await requireStaffPage("repair.write");
  return (
    <>
      <PageHeader title="問い合わせを登録" />
      <InquiryForm action={createInquiry} initial={{ receivedAt: nowLocalJst(), urgency: "normal", assigneeUid: ctx.uid }} cancelHref="/support" staff={await staffOptions(ctx)} />
    </>
  );
}
