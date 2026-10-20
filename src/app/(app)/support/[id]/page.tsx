import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc, findDocs, getMany } from "@/lib/server/repo";
import { staffName, staffNameMap } from "@/lib/server/lookups";
import { setInquiryStatus } from "@/lib/server/actions/support";
import { C, Inquiry, Property, Unit, Activity, Party } from "@/lib/types";
import { DetailHeader, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { Timeline } from "@/components/support/SupportNav";
import { ActivityForm } from "@/components/support/ActivityForm";
import {
  INQUIRY_STATUS, INQUIRY_CATEGORY, URGENCY, INQUIRY_SOURCE, ACTIVITY_CHANNEL, ACTIVITY_DIRECTION, REPAIR_STATUS,
  isInquiryOverdue, lbl, tone, RepairExt,
} from "@/lib/labels-support";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";

export default async function InquiryDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("repair.read");
  const { id } = await params;
  const i = await getDoc<Inquiry>(ctx, C.inquiries, id);
  if (!i) notFound();
  if (!canAccessStore(ctx, i.storeId)) return <div className="card"><StateMessage kind="forbidden" message="この店舗の問い合わせを閲覧する権限がありません" /></div>;
  const [property, unit, party, activities, repairs, names] = await Promise.all([
    i.propertyId ? getDoc<Property>(ctx, C.properties, i.propertyId) : null,
    i.unitId ? getDoc<Unit>(ctx, C.units, i.unitId) : null,
    i.partyId && ctx.caps.has("party.read") ? getDoc<Party>(ctx, C.parties, i.partyId) : null,
    findDocs<Activity>(ctx, C.activities, [["entity", "==", "inquiry"], ["entityId", "==", id]], 500),
    getMany<RepairExt>(ctx, C.repairs, i.repairIds ?? []),
    staffNameMap(ctx),
  ]);
  activities.sort((a, b) => a.at.localeCompare(b.at));
  const canWrite = ctx.caps.has("repair.write");
  const overdue = isInquiryOverdue(i, todayJst());

  return (
    <>
      <DetailHeader
        back={{ href: "/support", label: "問い合わせ一覧" }}
        number={i.number}
        title={`${i.partyName ?? "（相手未設定）"} ／ ${lbl(INQUIRY_CATEGORY, i.category)}`}
        badges={
          <>
            <Badge tone={tone(INQUIRY_STATUS, i.status)}>{lbl(INQUIRY_STATUS, i.status)}</Badge>
            <Badge tone={tone(URGENCY, i.urgency)}>緊急度: {lbl(URGENCY, i.urgency)}</Badge>
            {overdue && <Badge tone="danger">期限超過</Badge>}
            {i.source === "portal" && <Badge tone="info">外部ページから受付</Badge>}
          </>
        }
        meta={
          <>
            <span>担当: {await staffName(ctx, i.assigneeUid)}</span>
            <span>受付: {formatDateTimeJst(i.receivedAt)}</span>
            <span>期限: {i.due ?? "未設定"}</span>
          </>
        }
        actions={
          canWrite && (
            <>
              <Link href={`/support/${id}/edit`} className="btn btn-secondary">編集</Link>
              {i.status === "open" && <ActionButton action={setInquiryStatus} args={{ id, status: "in_progress" }} label="対応中にする" />}
              {i.status !== "done" && <ActionButton action={setInquiryStatus} args={{ id, status: "done" }} label="完了にする" confirm="この問い合わせを完了にしますか？" variant="primary" />}
              {i.status === "done" && <ActionButton action={setInquiryStatus} args={{ id, status: "in_progress" }} label="対応を再開" prompt="再開の理由" />}
              <Link href={`/support/repairs/new?inquiryId=${id}`} className="btn btn-secondary">修繕案件を作成</Link>
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <Card title="受付内容">
            <p className="break-words whitespace-pre-wrap">{i.content}</p>
          </Card>
          <Card title="基本情報">
            <DL
              items={[
                ["相手", party ? <Link href={`/parties/${party.id}`} className="text-primary hover:underline">{party.name}（{party.number}）</Link> : i.partyName],
                ["連絡先", party ? [party.phone, party.mobile, party.email].filter(Boolean).join(" / ") || null : null],
                ["物件", property ? <Link href={`/properties/${property.id}`} className="text-primary hover:underline">{property.name}</Link> : null],
                ["部屋", unit?.number ?? null],
                ["所在地", property?.address ?? null],
                ["分類", lbl(INQUIRY_CATEGORY, i.category)],
                ["受付経路", lbl(INQUIRY_SOURCE, i.source)],
                ["期限", i.due],
              ]}
            />
          </Card>
          <Card
            title="関連する修繕案件"
            actions={canWrite && <Link href={`/support/repairs/new?inquiryId=${id}`} className="btn btn-secondary btn-sm">＋ 修繕案件を作成</Link>}
          >
            {(i.repairIds ?? []).length === 0 ? (
              <p className="text-sm text-muted">修繕案件はまだありません</p>
            ) : (
              <ul className="divide-y divide-line">
                {(i.repairIds ?? []).map((rid) => {
                  const r = repairs.get(rid);
                  return (
                    <li key={rid} className="flex flex-wrap items-center gap-2 py-2">
                      {r ? (
                        <>
                          <Link href={`/support/repairs/${rid}`} className="text-primary hover:underline">{r.number}</Link>
                          <span className="min-w-0 flex-1 break-words">{r.equipment ? `${r.equipment}: ` : ""}{r.symptom}</span>
                          <Badge tone={tone(REPAIR_STATUS, r.status)}>{lbl(REPAIR_STATUS, r.status)}</Badge>
                        </>
                      ) : (
                        <span className="text-muted">（閲覧できない修繕案件）</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="対応記録（時系列）">
            <Timeline
              items={activities.map((a) => ({
                id: a.id,
                at: formatDateTimeJst(a.at),
                channel: lbl(ACTIVITY_CHANNEL, a.channel),
                direction: lbl(ACTIVITY_DIRECTION, a.direction),
                summary: a.summary,
                body: a.body,
                by: names.get(a.byUid) ?? (a.channel === "portal" ? "外部利用者" : "（不明）"),
              }))}
            />
          </Card>
          {canWrite && (
            <Card title="対応記録を追記">
              <ActivityForm entity="inquiry" entityId={id} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
