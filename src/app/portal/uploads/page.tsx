import { requireExternalPage } from "@/lib/server/portal-access";
import { col } from "@/lib/server/repo";
import { C, Attachment } from "@/lib/types";
import { Card, StateMessage } from "@/components/ui";
import { NoScope, NotForYou } from "@/components/portal/Guard";
import { PortalUpload } from "@/components/portal/PortalUpload";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "提出資料" };

export default async function PortalUploads() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  if (scope.kind !== "customer") return <NotForYou />;
  // 本人が提出したファイルのみ表示
  const snap = await col(ctx.companyId, C.attachments).where("linkKeys", "array-contains", `party:${scope.partyId}`).where("uploadedBy", "==", ctx.uid).limit(200).get();
  const files = snap.docs.map((d) => ({ ...(d.data() as Attachment), id: d.id })).filter((a) => !a.archived).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <h1 className="mb-4">提出資料</h1>
      <Card title="資料を提出する">
        <PortalUpload entity="party" entityId={scope.partyId} categories={["提出資料", "源泉徴収票・収入証明", "住民票", "その他"]} />
        <p className="help mt-2">提出された資料は担当者のみが確認します。本人確認書類は担当者の案内に従って提出してください。</p>
      </Card>
      <Card title="提出済みの資料" className="mt-4">
        {files.length === 0 ? (
          <StateMessage kind="empty" message="提出済みの資料はありません" />
        ) : (
          <ul className="divide-y divide-line">
            {files.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{f.fileName}</a>
                <span className="text-sm text-muted">{f.category} ／ {formatDateTimeJst(f.createdAt)}</span>
                {f.quarantined && <span className="text-sm text-danger">形式不一致のため受付できませんでした</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
