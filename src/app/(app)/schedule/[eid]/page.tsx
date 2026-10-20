import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, canAccessStore } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffName } from "@/lib/server/lookups";
import { archiveEvent } from "@/lib/server/actions/schedule";
import { C, Deal, Party, Property, Unit, EventDoc } from "@/lib/types";
import { DetailHeader, Card, DL, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { EVENT_TYPE } from "@/lib/labels-deals";
import { lbl } from "@/lib/labels";
import { formatDateTimeJst } from "@/lib/domain/dates";
import { jstDateOf, jstTime } from "@/lib/domain/deals";

export const metadata = { title: "予定" };

export default async function EventPage({ params }: { params: Promise<{ eid: string }> }) {
  const ctx = await requireStaffPage("schedule.read");
  const { eid } = await params;
  const e = await getDoc<EventDoc>(ctx, C.events, eid);
  if (!e) notFound();
  const deal = e.dealId && ctx.caps.has("deal.read") ? await getDoc<Deal>(ctx, C.deals, e.dealId) : null;
  const party = e.partyId && ctx.caps.has("party.read") ? await getDoc<Party>(ctx, C.parties, e.partyId) : null;
  const prop = e.propertyId ? await getDoc<Property>(ctx, C.properties, e.propertyId) : null;
  const unit = e.unitId ? await getDoc<Unit>(ctx, C.units, e.unitId) : null;
  const canEdit = ctx.caps.has("schedule.write") && canAccessStore(ctx, e.storeId);
  const date = jstDateOf(e.start);
  return (
    <>
      <DetailHeader
        back={{ href: `/schedule?view=week&date=${date}`, label: "予定" }}
        title={e.title}
        badges={
          <>
            <Badge>{lbl(EVENT_TYPE, e.type)}</Badge>
            {e.done ? <Badge tone="ok">実施済み</Badge> : <Badge>未実施</Badge>}
            {e.archived && <Badge>取消（アーカイブ）</Badge>}
          </>
        }
        meta={
          <>
            <span>{date} {jstTime(e.start)}〜{jstDateOf(e.end) !== date ? `${jstDateOf(e.end)} ` : ""}{jstTime(e.end)}</span>
            <span>担当: {await staffName(ctx, e.assigneeUid)}</span>
          </>
        }
        actions={
          canEdit && (
            <>
              <Link className="btn btn-primary" href={`/schedule/${eid}/result`}>{e.type === "viewing" ? "内見記録" : "実施結果を記録"}</Link>
              <Link className="btn btn-secondary" href={`/schedule/${eid}/edit`}>編集</Link>
              <ActionButton action={archiveEvent} args={{ id: eid, date }} label={e.archived ? "取消を戻す" : "予定を取消"} confirm={e.archived ? "予定を元に戻しますか？" : "この予定を取り消しますか？（記録は残ります）"} />
            </>
          )
        }
      />
      <Card title="予定の内容">
        <DL
          items={[
            ["開始", formatDateTimeJst(e.start)],
            ["終了", formatDateTimeJst(e.end)],
            ["移動時間（前後）", e.travelMinutes ? `${e.travelMinutes}分` : null],
            ["顧客", party ? <Link key="p" className="text-primary hover:underline" href={`/parties/${party.id}`}>{party.name}</Link> : null],
            ["物件・部屋", prop ? <Link key="pr" className="text-primary hover:underline" href={unit ? `/properties/${prop.id}/units/${unit.id}` : `/properties/${prop.id}`}>{prop.name}{unit ? ` ${unit.number}` : ""}</Link> : null],
            ["関連案件", deal ? <Link key="d" className="text-primary hover:underline" href={`/deals/${deal.id}?tab=viewings`}>{deal.number} {deal.title}</Link> : null],
            ["集合場所", e.place],
            ["鍵の受取方法", e.keyPickup],
            ["物件所在地", prop?.address ?? null],
          ]}
        />
      </Card>
      <Card title="実施結果" className="mt-4">
        {e.result ? <p className="whitespace-pre-wrap">{e.result}</p> : <p className="text-muted">未記録</p>}
      </Card>
    </>
  );
}
