import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffName, staffNameMap } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { archiveProperty, duplicateProperty } from "@/lib/server/actions/properties";
import { C, Property, Unit, Listing, Contract, Repair, Ownership, Party } from "@/lib/types";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { PROPERTY_KIND, OCCUPANCY, LISTING_STATUS, AREA_KIND, AREA_BASIS, USAGE, TRANSACTION_MODE, lbl, tone } from "@/lib/labels";
import { CONTRACT_STATUSES, REPAIR_STATUSES, labelOf } from "@/lib/domain/rules";
import { formatDateTimeJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";

const TABS = ["basic", "units", "listing", "files", "contracts", "repairs"];

export default async function PropertyDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("property.read");
  const { id } = await params;
  const sp = await searchParams;
  const p = await getDoc<Property>(ctx, C.properties, id);
  if (!p) notFound();
  const tab = tabOf(sp, TABS, "basic");
  const canWrite = ctx.caps.has("property.write");
  const units = await findDocs<Unit>(ctx, C.units, [["propertyId", "==", id]]);
  units.sort((a, b) => a.number.localeCompare(b.number, "ja", { numeric: true }));
  const base = `/properties/${id}`;

  return (
    <>
      <DetailHeader
        back={{ href: "/properties", label: "物件一覧" }}
        number={p.number}
        title={p.name}
        badges={
          <>
            <Badge>{lbl(PROPERTY_KIND, p.kind)}</Badge>
            {p.listingStatus && <Badge tone={tone(LISTING_STATUS, p.listingStatus)}>{lbl(LISTING_STATUS, p.listingStatus)}</Badge>}
            {p.archived && <Badge>アーカイブ</Badge>}
          </>
        }
        meta={
          <>
            <span>担当: {await staffName(ctx, p.assigneeUid)}</span>
            <span>{p.address ?? "所在地未入力"}</span>
            <span>更新: {formatDateTimeJst(p.updatedAt)}</span>
          </>
        }
        actions={
          canWrite && (
            <>
              <Link href={`${base}/edit`} className="btn btn-primary">編集</Link>
              <ActionButton action={duplicateProperty} args={{ id }} label="複製" confirm="基本情報を複製した新しい物件を作成します" />
              <ActionButton action={archiveProperty} args={{ id }} label={p.archived ? "アーカイブ解除" : "アーカイブ"} confirm={p.archived ? "アーカイブを解除しますか？" : "この物件をアーカイブしますか？（データは削除されません）"} />
            </>
          )
        }
      />
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: "basic", label: "基本情報" },
          { key: "units", label: "区画", count: units.length },
          { key: "listing", label: "募集条件" },
          { key: "files", label: "写真・資料" },
          { key: "contracts", label: "契約履歴" },
          { key: "repairs", label: "管理・修繕" },
        ]}
      />
      {tab === "basic" && <BasicTab p={p} ctxCompany={ctx.companyId} />}
      {tab === "units" && <UnitsTab propertyId={id} units={units} canWrite={canWrite} />}
      {tab === "listing" && <ListingTab propertyId={id} units={units} canWrite={canWrite} ctx={ctx} />}
      {tab === "files" && (
        <FileManager
          entity="property"
          entityId={id}
          canWrite={canWrite}
          items={(await listAttachments(ctx, "property", id)).map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
        />
      )}
      {tab === "contracts" && <ContractsTab ctx={ctx} propertyId={id} units={units} />}
      {tab === "repairs" && <RepairsTab ctx={ctx} propertyId={id} />}
    </>
  );
}

async function BasicTab({ p, ctxCompany }: { p: Property; ctxCompany: string }) {
  void ctxCompany;
  return (
    <div className="space-y-4">
      <Card title="基本情報">
        <DL
          items={[
            ["物件番号", p.number],
            ["種別", lbl(PROPERTY_KIND, p.kind)],
            ["郵便番号", p.postalCode],
            ["所在地", p.address],
            ["地番", p.lotNumber],
            ["構造", p.structure],
            ["築年月", p.builtYearMonth],
            ["階数", p.floorsAbove !== null ? `地上${p.floorsAbove}階${p.floorsBelow ? `・地下${p.floorsBelow}階` : ""}` : null],
            ["権利情報", p.rights],
            ["交通", p.access?.length ? p.access.map((a) => `${a.line} ${a.station}駅 徒歩${a.walkMin ?? "?"}分`).join(" / ") : null],
          ]}
        />
      </Card>
      <Card title="面積">
        {p.areas?.length ? (
          <table className="table">
            <thead><tr><th>種類</th><th>基準</th><th className="num">数値</th><th>根拠・備考</th></tr></thead>
            <tbody>
              {p.areas.map((a, i) => (
                <tr key={i}>
                  <td>{lbl(AREA_KIND, a.kind)}</td>
                  <td>{lbl(AREA_BASIS, a.basis)}</td>
                  <td className="num">{a.value} {a.unit === "m2" ? "㎡" : "坪"}</td>
                  <td>{a.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">未入力</p>
        )}
      </Card>
      <OwnersCard propertyId={p.id} />
      {p.memo && <Card title="社内メモ"><p className="whitespace-pre-wrap">{p.memo}</p></Card>}
    </div>
  );
}

async function OwnersCard({ propertyId }: { propertyId: string }) {
  const ctx = await requireStaffPage("property.read");
  const owns = await findDocs<Ownership>(ctx, C.ownerships, [["propertyId", "==", propertyId]]);
  const parties = new Map((await Promise.all(owns.map((o) => getDoc<Party>(ctx, C.parties, o.partyId)))).filter(Boolean).map((x) => [x!.id, x!]));
  return (
    <Card title="所有者・管理" actions={ctx.caps.has("property.write") && <Link className="btn btn-secondary btn-sm" href={`/properties/${propertyId}/owners`}>所有者を編集</Link>}>
      {owns.length === 0 ? (
        <p className="text-muted">所有者が登録されていません</p>
      ) : (
        <table className="table">
          <thead><tr><th>所有者</th><th>持分</th><th>送金配分</th><th>適用期間</th><th>管理料</th></tr></thead>
          <tbody>
            {owns.map((o) => (
              <tr key={o.id}>
                <td><Link className="text-primary hover:underline" href={`/parties/${o.partyId}`}>{parties.get(o.partyId)?.name ?? "（不明）"}</Link></td>
                <td>{o.share}</td>
                <td>{o.remitRatio ?? "持分どおり"}{o.remainderReceiver ? "（端数受取）" : ""}</td>
                <td>{o.from}〜{o.to ?? ""}</td>
                <td>
                  {o.managementFee
                    ? o.managementFee.kind === "fixed"
                      ? `定額 ${yen(o.managementFee.fixedAmount ?? 0)}`
                      : `${Number(o.managementFee.rate ?? 0) * 100}%（対象: ${o.managementFee.targetItemCodes.join("・")}）`
                    : "未設定"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function UnitsTab({ propertyId, units, canWrite }: { propertyId: string; units: Unit[]; canWrite: boolean }) {
  return (
    <Card title="区画一覧" actions={canWrite && <Link className="btn btn-primary btn-sm" href={`/properties/${propertyId}/units/new`}>＋ 区画を追加</Link>}>
      {units.length === 0 ? (
        <StateMessage kind="empty" message="部屋・駐車区画を登録してください" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>部屋番号</th><th>用途</th><th>間取り</th><th>面積</th><th>入居状態</th><th>募集状態</th><th>現在契約</th><th>募集予定</th><th>設備</th></tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td><Link className="font-semibold text-primary hover:underline" href={`/properties/${propertyId}/units/${u.id}`}>{u.number}</Link>{u.archived && " (アーカイブ)"}</td>
                  <td>{lbl(USAGE, u.usage)}</td>
                  <td>{u.layout ?? "—"}</td>
                  <td>{u.areas?.[0] ? `${u.areas[0].value}${u.areas[0].unit === "m2" ? "㎡" : "坪"}（${lbl(AREA_BASIS, u.areas[0].basis)}）` : "—"}</td>
                  <td><Badge tone={tone(OCCUPANCY, u.occupancy)}>{lbl(OCCUPANCY, u.occupancy)}</Badge>{u.expectedVacancyDate && <div className="text-xs text-muted">退去予定 {u.expectedVacancyDate}</div>}</td>
                  <td>{u.listingStatus ? <Badge tone={tone(LISTING_STATUS, u.listingStatus)}>{lbl(LISTING_STATUS, u.listingStatus)}</Badge> : "—"}</td>
                  <td>{u.currentContractId ? <Link className="text-primary hover:underline" href={`/contracts/${u.currentContractId}`}>契約を表示</Link> : "—"}</td>
                  <td>{u.availableFrom ?? "—"}</td>
                  <td className="max-w-48 text-xs">{u.equipment?.join("、") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

async function ListingTab({ propertyId, units, canWrite, ctx }: { propertyId: string; units: Unit[]; canWrite: boolean; ctx: Awaited<ReturnType<typeof requireStaffPage>> }) {
  const listings = await findDocs<Listing>(ctx, C.listings, [["propertyId", "==", propertyId]]);
  listings.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const current = listings.filter((l) => !l.supersededBy);
  const history = listings.filter((l) => l.supersededBy);
  const unitName = (uid: string | null) => (uid ? units.find((u) => u.id === uid)?.number ?? "（不明）" : "物件全体");
  const names = await staffNameMap(ctx);
  return (
    <div className="space-y-4">
      <Card title="現在の募集条件" actions={canWrite && <Link className="btn btn-primary btn-sm" href={`/properties/${propertyId}/listing`}>＋ 募集条件を登録</Link>}>
        {current.length === 0 ? (
          <StateMessage kind="empty" message="募集条件は未登録です" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>対象</th><th>取引</th><th>状態</th><th className="num">賃料・価格</th><th className="num">共益費</th><th className="num">敷金/礼金</th><th>入居可能日</th><th>取引態様</th><th>適用開始</th><th></th></tr></thead>
              <tbody>
                {current.map((l) => (
                  <tr key={l.id}>
                    <td>{unitName(l.unitId)}</td>
                    <td>{l.dealType === "rent" ? "賃貸" : "売買"}</td>
                    <td><Badge tone={tone(LISTING_STATUS, l.status)}>{lbl(LISTING_STATUS, l.status)}</Badge></td>
                    <td className="num">{yen(l.dealType === "rent" ? l.rent : l.price)}</td>
                    <td className="num">{yen(l.commonFee)}</td>
                    <td className="num">{yen(l.deposit)} / {yen(l.keyMoney)}</td>
                    <td>{l.availableFrom ?? "—"}</td>
                    <td>{lbl(TRANSACTION_MODE, l.transactionMode)}</td>
                    <td>{l.effectiveFrom}</td>
                    <td>{canWrite && <Link className="btn btn-secondary btn-sm" href={`/properties/${propertyId}/listing?from=${l.id}`}>条件を変更</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="過去の募集条件">
        {history.length === 0 ? (
          <p className="text-muted">変更履歴はありません</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>登録日時</th><th>登録者</th><th>対象</th><th>状態</th><th className="num">賃料・価格</th><th>適用開始</th></tr></thead>
              <tbody>
                {history.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDateTimeJst(l.createdAt)}</td>
                    <td>{names.get(l.createdBy) ?? "—"}</td>
                    <td>{unitName(l.unitId)}</td>
                    <td>{lbl(LISTING_STATUS, l.status)}</td>
                    <td className="num">{yen(l.dealType === "rent" ? l.rent : l.price)}</td>
                    <td>{l.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

async function ContractsTab({ ctx, propertyId, units }: { ctx: Awaited<ReturnType<typeof requireStaffPage>>; propertyId: string; units: Unit[] }) {
  if (!ctx.caps.has("contract.read")) return <div className="card"><StateMessage kind="forbidden" /></div>;
  const byProp = await findDocs<Contract>(ctx, C.contracts, [["propertyIds", "array-contains", propertyId]]);
  const ids = units.map((u) => u.id);
  const byUnit: Contract[] = [];
  for (let i = 0; i < ids.length; i += 30) byUnit.push(...(await findDocs<Contract>(ctx, C.contracts, [["unitId", "in", ids.slice(i, i + 30)]])));
  const all = [...new Map([...byProp, ...byUnit].map((c) => [c.id, c])).values()].sort((a, b) => ((a.start ?? "") < (b.start ?? "") ? 1 : -1));
  return (
    <Card title="契約履歴">
      {all.length === 0 ? (
        <StateMessage kind="empty" message="この物件の契約はまだありません" />
      ) : (
        <table className="table">
          <thead><tr><th>契約番号</th><th>件名</th><th>区画</th><th>状態</th><th>期間</th></tr></thead>
          <tbody>
            {all.map((c) => (
              <tr key={c.id}>
                <td><Link className="text-primary hover:underline" href={`/contracts/${c.id}`}>{c.number}</Link></td>
                <td>{c.title}</td>
                <td>{units.find((u) => u.id === c.unitId)?.number ?? "—"}</td>
                <td><Badge>{labelOf(CONTRACT_STATUSES, c.status)}</Badge></td>
                <td>{c.start ?? "未定"}〜{c.end ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

async function RepairsTab({ ctx, propertyId }: { ctx: Awaited<ReturnType<typeof requireStaffPage>>; propertyId: string }) {
  if (!ctx.caps.has("repair.read")) return <div className="card"><StateMessage kind="forbidden" /></div>;
  const repairs = await findDocs<Repair>(ctx, C.repairs, [["propertyId", "==", propertyId]]);
  repairs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <Card title="修繕案件" actions={ctx.caps.has("repair.write") && <Link className="btn btn-secondary btn-sm" href={`/support/repairs/new?propertyId=${propertyId}`}>＋ 修繕を登録</Link>}>
      {repairs.length === 0 ? (
        <StateMessage kind="empty" message="修繕案件はありません" />
      ) : (
        <table className="table">
          <thead><tr><th>番号</th><th>症状</th><th>状態</th><th>登録日</th></tr></thead>
          <tbody>
            {repairs.map((r) => (
              <tr key={r.id}>
                <td><Link className="text-primary hover:underline" href={`/support/repairs/${r.id}`}>{r.number}</Link></td>
                <td>{r.symptom}</td>
                <td><Badge>{labelOf(REPAIR_STATUSES, r.status)}</Badge></td>
                <td>{formatDateTimeJst(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
