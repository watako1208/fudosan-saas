import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc, getMany } from "@/lib/server/repo";
import { staffName } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { saveApplication, archiveApplication } from "@/lib/server/actions/applications";
import { C, Deal, Party, Property, Unit, ApplicationDoc } from "@/lib/types";
import { DetailHeader, Card, DL, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { ApplicationForm } from "@/components/deals/ApplicationForm";
import { APPLICATION_STATUS, LANDLORD_CHECK } from "@/lib/labels-deals";
import { lbl, tone } from "@/lib/labels";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "申込み" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const ctx = await requireStaffPage("deal.read");
  const { id, aid } = await params;
  const deal = await getDoc<Deal>(ctx, C.deals, id);
  const raw = await getDoc<ApplicationDoc>(ctx, C.applications, aid);
  if (!deal || !raw || raw.dealId !== id) notFound();
  const sensitive = ctx.caps.has("party.sensitive");
  // 否決理由は権限者以外へ渡さない（サーバー側で除去）
  const app: Omit<ApplicationDoc, "rejectReason"> & { rejectReason?: string | null } = { ...raw };
  if (!sensitive) delete app.rejectReason;
  const canEdit = ctx.caps.has("deal.write") && canAccessStore(ctx, deal.storeId);
  const parties = await getMany<Party>(ctx, C.parties, [app.applicantId, ...app.occupantIds]);
  const units = await getMany<Unit>(ctx, C.units, deal.unitIds ?? []);
  const props = await getMany<Property>(ctx, C.properties, [...units.values()].map((u) => u.propertyId));
  const unitOpts = [...units.values()].map((u) => ({ value: u.id, label: `${props.get(u.propertyId)?.name ?? ""} ${u.number}` }));
  const atts = await listAttachments(ctx, "application", aid);
  const pick = (pid: string) => ({ id: pid, label: parties.get(pid)?.name ?? "（不明）", sub: parties.get(pid)?.number });
  const applicantName = parties.get(app.applicantId)?.name ?? "（不明）";

  return (
    <>
      <DetailHeader
        back={{ href: `/deals/${id}?tab=applications`, label: `${deal.number} ${deal.title}` }}
        title={`申込み: ${applicantName}`}
        badges={
          <>
            <Badge tone={tone(APPLICATION_STATUS, app.status)}>{lbl(APPLICATION_STATUS, app.status)}</Badge>
            {app.landlordCheck && <Badge tone={tone(LANDLORD_CHECK, app.landlordCheck)}>貸主確認: {lbl(LANDLORD_CHECK, app.landlordCheck)}</Badge>}
            {app.archived && <Badge>アーカイブ</Badge>}
          </>
        }
        meta={<span>登録: {formatDateTimeJst(app.createdAt)}</span>}
        actions={canEdit && <ActionButton action={archiveApplication} args={{ id: aid }} label="アーカイブ" confirm="この申込みをアーカイブしますか？" />}
      />
      <Card title="審査結果の記録" className="mb-4">
        <DL
          items={[
            ["状態", lbl(APPLICATION_STATUS, app.status)],
            ["結果の記録者", app.resultRecordedBy ? await staffName(ctx, app.resultRecordedBy) : null],
            ["記録日時", app.resultRecordedAt ? formatDateTimeJst(app.resultRecordedAt) : null],
            ["保証会社", app.guarantorCompany],
            ...(sensitive && app.status === "rejected" ? ([["否決理由", app.rejectReason ?? null]] as [string, string | null][]) : []),
          ]}
        />
      </Card>
      {canEdit ? (
        <ApplicationForm
          action={saveApplication.bind(null, id, aid)}
          initial={JSON.parse(JSON.stringify(app))}
          version={app.version}
          applicant={pick(app.applicantId)}
          occupants={app.occupantIds.map(pick)}
          units={unitOpts}
          attachments={atts.map((a) => ({ id: a.id, label: `${a.category}: ${a.fileName}` }))}
          canSensitive={sensitive}
          cancelHref={`/deals/${id}?tab=applications`}
        />
      ) : (
        <Card title="申込み内容">
          <DL
            items={[
              ["申込者", applicantName],
              ["同居人", app.occupantIds.map((o) => parties.get(o)?.name ?? "—").join("、") || null],
              ["希望入居日", app.desiredMoveIn],
              ["提出書類", app.submittedDocs.map((d) => `${d.name}${d.received ? "（受領）" : "（未受領）"}`).join("、") || null],
            ]}
          />
        </Card>
      )}
      <h2 className="mt-6 mb-2">申込み書類</h2>
      <FileManager
        entity="application"
        entityId={aid}
        canWrite={canEdit}
        allowSensitive={sensitive}
        categories={["申込書", "本人確認書類", "収入証明", "住民票", "審査結果", "その他"]}
        items={atts.map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
      />
    </>
  );
}
