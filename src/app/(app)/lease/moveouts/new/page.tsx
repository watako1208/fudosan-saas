import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { C, Contract } from "@/lib/types";
import { PageHeader, Card, StateMessage } from "@/components/ui";
import { NewMoveoutForm } from "@/components/lease/LeaseForms";
import { todayJst } from "@/lib/domain/dates";

export const metadata = { title: "解約・退去の登録" };

export default async function NewMoveoutPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("lease.write");
  const sp = await searchParams;
  const contractId = typeof sp.contractId === "string" ? sp.contractId : "";
  const c = contractId ? await getDoc<Contract>(ctx, C.contracts, contractId) : null;
  if (!c || c.kind !== "lease" || !["executed", "active"].includes(c.status)) {
    return (
      <>
        <PageHeader title="解約・退去の登録" />
        <Card>
          <StateMessage
            kind="empty"
            message="締結記録済み・契約期間中の賃貸契約の詳細画面から登録してください。"
            action={<Link className="btn btn-secondary" href="/contracts?kind=lease">契約一覧へ</Link>}
          />
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="解約・退去の登録" sub={`${c.number} ${c.title}`} />
      <NewMoveoutForm contractId={c.id} today={todayJst()} contractLabel={`${c.number} ${c.title}`} />
    </>
  );
}
