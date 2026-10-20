import Link from "next/link";
import { requireExternalPage, externalCanViewAttachment } from "@/lib/server/portal-access";
import { getDoc, col } from "@/lib/server/repo";
import { staffName, companySettings } from "@/lib/server/lookups";
import { vendorSubmitEstimate } from "@/lib/server/actions/portal";
import { C, Property, Unit, Attachment } from "@/lib/types";
import { Card, DL, Badge, StateMessage } from "@/components/ui";
import { NoScope } from "@/components/portal/Guard";
import { PortalUpload } from "@/components/portal/PortalUpload";
import { EstimateEditor } from "@/components/support/EstimateEditor";
import { REPAIR_STATUS, REPAIR_PHOTO_CATEGORIES, ESTIMATE_STATUS, lbl, tone, RepairExt, EstimateExt } from "@/lib/labels-support";
import { yen } from "@/lib/domain/money";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "ご依頼" };

/** 工事業者: 割り当てられた依頼。必要な連絡先は施工場所と当社担当者のみ（入居者・オーナー情報は表示しない） */
export default async function VendorRepair({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  const { id } = await params;
  const r = scope.kind === "vendor" && scope.repairIds.has(id) ? await getDoc<RepairExt>(ctx, C.repairs, id) : null;
  if (!r || r.vendorPartyId !== scope.partyId) return <div className="card"><StateMessage kind="forbidden" message="このご依頼は表示できません" /></div>;
  const [p, u, est, assignee, settings, attSnap] = await Promise.all([
    r.propertyId ? getDoc<Property>(ctx, C.properties, r.propertyId) : null,
    r.unitId ? getDoc<Unit>(ctx, C.units, r.unitId) : null,
    r.currentEstimateId ? getDoc<EstimateExt>(ctx, C.estimates, r.currentEstimateId) : null,
    staffName(ctx, r.assigneeUid),
    companySettings(ctx.companyId),
    col(ctx.companyId, C.attachments).where("linkKeys", "array-contains", `repair:${id}`).limit(300).get(),
  ]);
  const atts: Attachment[] = [];
  for (const d of attSnap.docs) {
    const a = { ...(d.data() as Attachment), id: d.id };
    if (!a.archived && (await externalCanViewAttachment(ctx, a))) atts.push(a);
  }
  const canEditEstimate = !["completed", "cancelled"].includes(r.status) && (!est || (est.status === "draft" && est.createdBy === ctx.uid));
  const closed = ["completed", "cancelled"].includes(r.status);
  return (
    <>
      <Link href="/portal/repairs" className="text-sm text-primary hover:underline">← ご依頼一覧</Link>
      <div className="mt-1 mb-4 flex flex-wrap items-center gap-2">
        <h1 className="break-words">{p?.name ?? "物件"}{u ? ` ${u.number}` : ""}</h1>
        <Badge tone={tone(REPAIR_STATUS, r.status)}>{lbl(REPAIR_STATUS, r.status)}</Badge>
      </div>
      <Card title="ご依頼内容">
        <DL
          items={[
            ["依頼番号", r.number],
            ["施工場所", p?.address ? `${p.address}${u ? ` ${u.number}` : ""}` : null],
            ["対象設備", r.equipment],
            ["症状・内容", <span key="s" className="whitespace-pre-wrap">{r.symptom}</span>],
            ["施工予定日", r.scheduledDate],
            ["当社担当者", assignee],
          ]}
        />
        <p className="help mt-2">入居者への連絡・立会いの調整は当社担当者を通じて行ってください。</p>
      </Card>

      <Card title="見積明細の提出" className="mt-4">
        {est && (
          <p className="mb-2 text-sm">
            現在の見積: 第{est.versionNo}版 <Badge tone={tone(ESTIMATE_STATUS, est.status)}>{lbl(ESTIMATE_STATUS, est.status)}</Badge> 合計 {yen(est.total)}（更新 {formatDateTimeJst(est.updatedAt)}）
          </p>
        )}
        {canEditEstimate ? (
          <>
            <EstimateEditor
              repairId={id}
              initialLines={est?.lines ?? []}
              lineRounding={settings.lineRounding ?? "floor"}
              taxRounding={settings.taxRounding ?? "floor"}
              action={vendorSubmitEstimate}
              vendorMode
              saveLabel="見積明細を提出"
            />
            <p className="help mt-2">提出した明細は当社で確認します。費用負担の区分は当社で判断します。</p>
          </>
        ) : (
          <p className="text-sm text-muted">
            {closed ? "この依頼は完了または中止しています。" : "当社で確認中または承認済みの見積があります。追加・変更がある場合は担当者へご連絡ください（担当者が変更版を作成します）。"}
          </p>
        )}
      </Card>

      <Card title="工事写真・資料の提出" className="mt-4">
        {!closed && <PortalUpload entity="repair" entityId={id} categories={REPAIR_PHOTO_CATEGORIES} />}
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {atts.map((a) => (
            <li key={a.id} className="text-sm">
              <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="block">
                {a.contentType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${a.id}`} alt={a.description ?? a.fileName} className="aspect-square w-full rounded border border-line object-cover" />
                ) : (
                  <span className="flex aspect-square items-center justify-center rounded border border-line bg-bg p-2 text-center break-all">{a.fileName}</span>
                )}
              </a>
              <p className="mt-1 text-muted">{a.category}</p>
            </li>
          ))}
        </ul>
        {atts.length === 0 && <p className="text-sm text-muted">提出済みの写真・資料はありません</p>}
      </Card>
    </>
  );
}
