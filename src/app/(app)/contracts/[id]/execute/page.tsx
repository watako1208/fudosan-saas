import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffOptions } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { C, Contract } from "@/lib/types";
import { PageHeader, Card, StateMessage } from "@/components/ui";
import { FileManager } from "@/components/FileManager";
import { ExecuteForm } from "@/components/contracts/SmallForms";
import { todayJst } from "@/lib/domain/dates";

export default async function ExecuteContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("contract.write");
  const { id } = await params;
  const c = await getDoc<Contract>(ctx, C.contracts, id);
  if (!c) notFound();
  if (c.status !== "approved") {
    return (
      <>
        <PageHeader title={`締結の記録: ${c.title}`} sub={c.number} />
        <Card>
          <StateMessage kind="empty" message="社内承認済みの契約のみ締結を記録できます。" action={<Link className="btn btn-secondary" href={`/contracts/${id}`}>契約へ戻る</Link>} />
        </Card>
      </>
    );
  }
  const files = await listAttachments(ctx, "contract", id);
  return (
    <>
      <PageHeader title={`締結の記録: ${c.title}`} sub={`${c.number}・外部の電子署名サービスとは連携しません。署名済みの書類を登録して記録します。`} />
      <ExecuteForm
        contractId={id}
        attachments={files.map((f) => ({ value: f.id, label: `${f.fileName}（${f.category}）` }))}
        staff={await staffOptions(ctx)}
        defaultBy={ctx.uid}
        today={todayJst()}
      />
      <h2 className="mb-2 mt-2">書類の登録</h2>
      <FileManager
        entity="contract"
        entityId={id}
        canWrite
        categories={["契約書", "重要事項説明", "本人確認", "その他"]}
        items={files.map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
      />
    </>
  );
}
