import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs } from "@/lib/server/repo";
import { C, Contract, ContractVersion } from "@/lib/types";
import { PageHeader, Card, StateMessage } from "@/components/ui";
import { ChangeVersionForm } from "@/components/contracts/SmallForms";

export default async function ChangeContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("contract.write");
  const { id } = await params;
  const c = await getDoc<Contract>(ctx, C.contracts, id);
  if (!c) notFound();
  const versions = await findDocs<ContractVersion>(ctx, C.contractVersions, [["contractId", "==", id]]);
  const pending = versions.find((v) => v.status === "draft" && !v.archived && v.id !== c.currentVersionId);
  if (pending) redirect(`/contracts/${id}/edit?versionId=${pending.id}`);
  const cur = versions.find((v) => v.id === c.currentVersionId);
  if (!["executed", "active"].includes(c.status) || !cur) {
    return (
      <>
        <PageHeader title={`条件変更: ${c.title}`} sub={c.number} />
        <Card>
          <StateMessage kind="empty" message="条件変更は締結記録済み・契約期間中の契約で行えます。締結前の契約は下書きを編集してください。" action={<Link className="btn btn-secondary" href={`/contracts/${id}`}>契約へ戻る</Link>} />
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title={`条件変更: ${c.title}`} sub={`${c.number}・現在の版: 第${cur.versionNo}版（${cur.effectiveFrom}〜）`} />
      <ChangeVersionForm contractId={id} minDate={cur.effectiveFrom} />
    </>
  );
}
