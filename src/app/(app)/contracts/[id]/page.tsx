import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage, Ctx } from "@/lib/server/session";
import { getDoc, getMany, findDocs } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffName, staffNameMap } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import {
  submitContract, approveContract, rejectContract, recordOverlapException, activateContract, endContract, cancelContract, discardChangeVersion,
} from "@/lib/server/actions/contracts";
import { C, Contract, ContractVersion, Unit, Property, Renewal, Moveout, DepositEntryDoc, DocumentDoc, TaskDoc, DeadlineRule } from "@/lib/types";
import { DetailHeader, Tabs, Card, DL, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { DepositPanel } from "@/components/lease/DepositPanel";
import { lbl, tone } from "@/lib/labels";
import {
  CONTRACT_KIND, CONTRACT_STATUS, VERSION_STATUS, LEASE_TYPE, CONTRACT_PARTY_ROLE, PAYMENT_TIMING, DEPOSIT_HOLDER, PRORATION_METHOD, ROUNDING,
  TAX_CATEGORY, PRICE_MODE, APPROVAL_ACTION, RENEWAL_STATUS, MOVEOUT_STATUS, BROKERAGE_METHOD, FIXED30_COUNTING, HOLIDAY_ADJUST,
} from "@/lib/labels-contracts";
import { findOverlappingContracts } from "@/lib/domain/rules";
import { leaseConfirmErrors, saleConfirmErrors, firstMonthProration, versionAmountDiff, noticeDeadlineFromRule } from "@/lib/domain/contracts";
import { formatDateTimeJst, todayJst, compare } from "@/lib/domain/dates";
import { yen, TaxSetting } from "@/lib/domain/money";

const LEASE_TABS = ["basic", "monthly", "initial", "renewal", "parties", "documents", "versions", "deposit", "approvals"];
const SALE_TABS = ["basic", "parties", "documents", "versions", "approvals"];

const taxText = (t: TaxSetting) => `${lbl(TAX_CATEGORY, t.category)}${t.category === "taxable" ? ` ${Number(t.rate) * 100}%・${lbl(PRICE_MODE, t.priceMode)}` : ""}`;
const ruleText = (r: DeadlineRule | null | undefined) =>
  r ? `契約終了日の ${r.amount}${r.unit === "months" ? "か月前" : "日前"}（休日: ${lbl(HOLIDAY_ADJUST, r.holidayAdjust)}）` : null;

export default async function ContractDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("contract.read");
  const { id } = await params;
  const sp = await searchParams;
  const c = await getDoc<Contract>(ctx, C.contracts, id);
  if (!c) notFound();
  const isLease = c.kind !== "sale";
  const tab = tabOf(sp, isLease ? LEASE_TABS : SALE_TABS, "basic");
  const versions = (await findDocs<ContractVersion>(ctx, C.contractVersions, [["contractId", "==", id]])).filter((v) => !v.archived).sort((a, b) => a.versionNo - b.versionNo);
  const ver = versions.find((v) => v.id === c.currentVersionId) ?? null;
  const pending = versions.find((v) => v.status === "draft" && v.id !== c.currentVersionId) ?? null;
  const unit = c.unitId ? await getDoc<Unit>(ctx, C.units, c.unitId) : null;
  const props = await getMany<Property>(ctx, C.properties, [...(c.propertyIds ?? []), unit?.propertyId ?? ""]);
  const canWrite = ctx.caps.has("contract.write");
  const canApprove = ctx.caps.has("contract.approve");
  const base = `/contracts/${id}`;
  const cancelReason = (c as Contract & { cancelReason?: string }).cancelReason;
  const rejectedBefore = (c.approvals ?? []).some((a) => a.action === "reject");

  const actions = (
    <>
      {canWrite && c.status === "draft" && <Link href={`${base}/edit`} className="btn btn-secondary">編集</Link>}
      {canWrite && c.status === "draft" && (
        <ActionButton action={submitContract} args={{ id }} variant="primary" label={rejectedBefore ? "再提出（社内確認へ）" : "社内確認へ提出"} confirm="入力内容を検証し、社内確認へ提出します。" />
      )}
      {canApprove && c.status === "in_review" && (
        <>
          <ActionButton action={approveContract} args={{ id }} variant="primary" label="社内承認" confirm="この契約内容を社内承認します（外部の電子署名ではありません）。" />
          <ActionButton action={rejectContract} args={{ id }} label="差戻し" prompt="差戻し理由を入力してください（必須）" />
        </>
      )}
      {canWrite && c.status === "approved" && <Link href={`${base}/execute`} className="btn btn-primary">締結を記録</Link>}
      {canWrite && c.status === "executed" && (
        <ActionButton action={activateContract} args={{ id }} variant="primary" label="契約期間中にする" confirm="契約期間中にします。賃貸の場合は部屋を「入居中」にします。" />
      )}
      {canWrite && ["executed", "active"].includes(c.status) && (pending ? (
        <Link href={`${base}/edit?versionId=${pending.id}`} className="btn btn-secondary">条件変更（第{pending.versionNo}版）を編集</Link>
      ) : (
        <Link href={`${base}/change`} className="btn btn-secondary">条件変更（新しい版）</Link>
      ))}
      {isLease && ctx.caps.has("lease.write") && ["executed", "active"].includes(c.status) && (
        <Link href={`/lease/moveouts/new?contractId=${id}`} className="btn btn-secondary">解約・退去を登録</Link>
      )}
      {canWrite && ["executed", "active"].includes(c.status) && (
        <ActionButton action={endContract} args={{ id }} label="終了" prompt="契約の終了日を YYYY-MM-DD で入力してください" variant="ghost" />
      )}
      {canWrite && !["ended", "cancelled"].includes(c.status) && (
        <ActionButton action={cancelContract} args={{ id }} label="取消" prompt="取消理由を入力してください（必須）" variant="danger" confirm="この契約を取り消します。金銭の記録は自動では削除されません。" />
      )}
    </>
  );

  const tabs = [
    { key: "basic", label: "基本条件" },
    ...(isLease ? [{ key: "monthly", label: "月額費用" }, { key: "initial", label: "初期費用" }, { key: "renewal", label: "更新・解約" }] : []),
    { key: "parties", label: "当事者", count: ver?.parties.length ?? 0 },
    { key: "documents", label: "書類" },
    { key: "versions", label: "版履歴", count: versions.length },
    ...(isLease ? [{ key: "deposit", label: "敷金" }] : []),
    { key: "approvals", label: "承認履歴" },
  ];

  return (
    <>
      <DetailHeader
        back={{ href: "/contracts", label: "契約一覧" }}
        number={c.number}
        title={c.title}
        badges={
          <>
            <Badge>{lbl(CONTRACT_KIND, c.kind)}</Badge>
            <Badge tone={tone(CONTRACT_STATUS, c.status)}>{lbl(CONTRACT_STATUS, c.status)}</Badge>
            {pending && <Badge tone="warn">未確定の条件変更あり</Badge>}
          </>
        }
        meta={
          <>
            <span>担当: {await staffName(ctx, c.assigneeUid)}</span>
            <span>期間: {c.start ?? "未定"}〜{c.end ?? (isLease ? "定めなし・未定" : "")}</span>
            {unit && <Link className="text-primary hover:underline" href={`/properties/${unit.propertyId}/units/${unit.id}`}>{props.get(unit.propertyId)?.name} {unit.number}</Link>}
            {c.dealId && <Link className="text-primary hover:underline" href={`/deals/${c.dealId}`}>仲介案件</Link>}
          </>
        }
        actions={actions}
      />
      {c.status === "cancelled" && cancelReason && <p className="mb-4 rounded-md border border-line bg-surface p-3 text-sm">取消理由: {cancelReason}</p>}
      <Tabs base={base} current={tab} tabs={tabs} />
      {!ver ? (
        <div className="card"><StateMessage kind="error" message="契約条件（版）を読み込めませんでした" /></div>
      ) : (
        <>
          {tab === "basic" && <BasicTab ctx={ctx} c={c} ver={ver} unit={unit} props={props} pending={pending} />}
          {tab === "monthly" && <MonthlyTab ver={ver} />}
          {tab === "initial" && <InitialTab c={c} ver={ver} />}
          {tab === "renewal" && <RenewalTab ctx={ctx} c={c} ver={ver} />}
          {tab === "parties" && <PartiesTab ver={ver} />}
          {tab === "documents" && <DocumentsTab ctx={ctx} c={c} ver={ver} canWrite={canWrite} />}
          {tab === "versions" && <VersionsTab ctx={ctx} c={c} versions={versions} canWrite={canWrite} />}
          {tab === "deposit" && <DepositTab ctx={ctx} c={c} ver={ver} />}
          {tab === "approvals" && <ApprovalsTab ctx={ctx} c={c} />}
        </>
      )}
    </>
  );
}

async function BasicTab({ ctx, c, ver, unit, props, pending }: { ctx: Ctx; c: Contract; ver: ContractVersion; unit: Unit | null; props: Map<string, Property>; pending: ContractVersion | null }) {
  const isLease = c.kind !== "sale";
  const today = todayJst();
  const checks =
    ["draft", "in_review"].includes(c.status)
      ? isLease
        ? leaseConfirmErrors({ parties: ver.parties, unitId: c.unitId, leaseType: ver.leaseType, start: ver.start, end: ver.end, monthlyItems: ver.monthlyItems, documentsChecked: ver.documentsChecked, depositAmount: ver.depositAmount, depositHolder: c.depositHolder })
        : saleConfirmErrors({ parties: ver.parties, propertyIds: c.propertyIds, salePrice: ver.salePrice, earnestMoney: ver.earnestMoney, balanceAmount: ver.balanceAmount, contractDate: ver.contractDate, settlementDate: ver.settlementDate, deliveryDate: ver.deliveryDate, documentsChecked: ver.documentsChecked })
      : [];
  let overlaps: Contract[] = [];
  if (isLease && c.unitId && ver.start && ["draft", "in_review", "approved"].includes(c.status)) {
    const others = await findDocs<Contract>(ctx, C.contracts, [["unitId", "==", c.unitId]]);
    const hit = new Set(
      findOverlappingContracts(
        { id: c.id, unitId: c.unitId, start: ver.start, end: ver.end },
        others.filter((o) => o.start && !o.archived).map((o) => ({ id: o.id, unitId: o.unitId!, status: o.status, start: o.start!, end: o.end })),
      ).map((o) => o.id),
    );
    overlaps = others.filter((o) => hit.has(o.id));
  }
  const isAdmin = ctx.user.roles.includes("admin");
  const tasks = !isLease ? (await findDocs<TaskDoc>(ctx, C.tasks, [["entity", "==", "contract"], ["entityId", "==", c.id]])).filter((t) => !t.archived).sort((a, b) => (a.due < b.due ? -1 : 1)) : [];
  const executor = c.executedBy ? await staffName(ctx, c.executedBy) : null;

  return (
    <div className="space-y-4">
      {checks.length > 0 && (
        <Card title="確定前の確認（不足項目）">
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger">{checks.map((e, i) => <li key={i}>{e}</li>)}</ul>
          <p className="help">不足を解消するまで社内確認への提出・承認はできません。</p>
        </Card>
      )}
      {(overlaps.length > 0 || c.overlapException) && (
        <Card title="同じ部屋の契約期間の重なり">
          {overlaps.length > 0 && (
            <>
              <p className="text-sm text-danger">以下の確定契約と期間が重なっています。現在の契約の終了日以降に開始する場合は登録できます。</p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {overlaps.map((o) => (
                  <li key={o.id}><Link className="text-primary hover:underline" href={`/contracts/${o.id}`}>{o.number} {o.title}</Link>（{lbl(CONTRACT_STATUS, o.status)}・{o.start}〜{o.end ?? "期間の定めなし"}）</li>
                ))}
              </ul>
            </>
          )}
          {c.overlapException ? (
            <p className="mt-2 text-sm">管理者による例外: {c.overlapException.reason}（{await staffName(ctx, c.overlapException.approvedBy)}・{formatDateTimeJst(c.overlapException.at)}）</p>
          ) : (
            isAdmin && ["draft", "in_review"].includes(c.status) && (
              <div className="mt-3">
                <ActionButton action={recordOverlapException} args={{ id: c.id }} label="例外として記録（管理者）" prompt="例外とする理由を入力してください（必須）" />
              </div>
            )
          )}
        </Card>
      )}
      {pending && (
        <Card title="未確定の条件変更">
          <p className="text-sm">第{pending.versionNo}版（{pending.effectiveFrom}から適用予定）が下書きです。確定するまで現在の条件が適用されます。</p>
          <Link className="btn btn-secondary btn-sm mt-2" href={`/contracts/${c.id}/edit?versionId=${pending.id}`}>変更版を編集</Link>
        </Card>
      )}
      {c.status === "executed" && isLease && unit && unit.currentContractId !== c.id && ver.start && compare(ver.start, today) > 0 && (
        <p className="rounded-md border border-line bg-surface p-3 text-sm">
          契約開始日（{ver.start}）が未到来のため、部屋の入居状態はまだ変更していません。開始日以降に「契約期間中にする」を実行すると入居中になります。
        </p>
      )}
      <Card title="基本条件">
        {isLease ? (
          <DL
            items={[
              ["契約番号", c.number],
              ["対象", unit ? `${props.get(unit.propertyId)?.name ?? ""} ${unit.number}` : null],
              ["契約種別", ver.leaseType ? lbl(LEASE_TYPE, ver.leaseType) : null],
              ["契約期間", ver.start ? `${ver.start}〜${ver.end ?? "期間の定めなし"}` : null],
              ["支払期日", ver.paymentDueDay ? `毎月${ver.paymentDueDay}日（${lbl(PAYMENT_TIMING, ver.paymentTiming)}）` : null],
              ["敷金", ver.depositAmount === null ? null : `${yen(ver.depositAmount)}（${c.depositHolder ? lbl(DEPOSIT_HOLDER, c.depositHolder) : "保管主体未設定"}）`],
              ["円未満の扱い", lbl(ROUNDING, ver.rounding)],
              ["適用中の版", `第${ver.versionNo}版（${ver.effectiveFrom}〜${ver.effectiveTo ?? ""}）${lbl(VERSION_STATUS, ver.status)}`],
              ["締結記録", c.executedAt ? `${c.executedAt}（確認者: ${executor}）` : null],
            ]}
          />
        ) : (
          <DL
            items={[
              ["契約番号", c.number],
              ["対象の土地・建物", (c.propertyIds ?? []).length ? (c.propertyIds ?? []).map((pid) => props.get(pid)?.name ?? "（不明）").join("、") : null],
              ["売買代金", ver.salePrice === null ? null : yen(ver.salePrice)],
              ["手付金", ver.earnestMoney === null ? null : yen(ver.earnestMoney)],
              ["残代金", ver.balanceAmount === null ? null : yen(ver.balanceAmount)],
              ["契約日", ver.contractDate],
              ["決済予定日", ver.settlementDate],
              ["引渡日", ver.deliveryDate],
              ["融資", ver.loan ? `${ver.loan.lender ?? "金融機関未入力"} ${ver.loan.amount === null ? "" : yen(ver.loan.amount)}・承認期限 ${ver.loan.deadline ?? "未入力"}${ver.loan.contingent ? "・融資特約あり" : ""}` : "なし"],
              ["締結記録", c.executedAt ? `${c.executedAt}（確認者: ${executor}）` : null],
            ]}
          />
        )}
      </Card>
      {!isLease && (
        <Card title="決済までのタスク">
          {tasks.length === 0 ? (
            <p className="text-muted">融資期限・決済予定日を入力して保存するとタスクを作成します</p>
          ) : (
            <table className="table">
              <thead><tr><th>タスク</th><th>期限</th><th>状態</th></tr></thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{t.due}</td>
                    <td>{t.done ? <Badge tone="ok">完了</Badge> : compare(t.due, today) < 0 ? <Badge tone="danger">期限超過</Badge> : <Badge>未完了</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {ver.brokerageFee && (
        <Card title="仲介手数料">
          <DL
            items={[
              ["計算方法", lbl(BROKERAGE_METHOD, ver.brokerageFee.method)],
              ["料率", ver.brokerageFee.rate],
              ["定額", ver.brokerageFee.fixed === null ? null : yen(ver.brokerageFee.fixed)],
              ["加算額", ver.brokerageFee.plus === null ? null : yen(ver.brokerageFee.plus)],
              ["税", taxText(ver.brokerageFee.tax)],
              ["請求先", { lessee: "借主", lessor: "貸主", buyer: "買主", seller: "売主", both: "双方" }[ver.brokerageFee.billTo ?? ""] ?? ver.brokerageFee.billTo],
            ]}
          />
        </Card>
      )}
      <Card title="特約">{ver.specialTerms ? <p className="whitespace-pre-wrap">{ver.specialTerms}</p> : <p className="text-muted">未入力</p>}</Card>
    </div>
  );
}

function MonthlyTab({ ver }: { ver: ContractVersion }) {
  const preview = ver.start ? firstMonthProration(ver.monthlyItems, ver.start, ver.end) : [];
  const total = ver.monthlyItems.reduce((s, m) => s + (m.amount ?? 0), 0);
  return (
    <div className="space-y-4">
      <Card title={`月額費用（第${ver.versionNo}版）`}>
        {ver.monthlyItems.length === 0 ? (
          <StateMessage kind="empty" message="月額費用が設定されていません" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>費目</th><th className="num">月額</th><th>税</th><th>日割り</th><th>円未満</th></tr></thead>
              <tbody>
                {ver.monthlyItems.map((m) => (
                  <tr key={m.code}>
                    <td>{m.name}</td>
                    <td className="num">{m.amount === null ? "未入力" : yen(m.amount)}</td>
                    <td>{taxText(m.tax)}</td>
                    <td>{lbl(PRORATION_METHOD, m.proration?.method ?? "actual")}{m.proration?.method === "fixed30" && `（${lbl(FIXED30_COUNTING, m.proration.fixed30Counting ?? "calendar_cap30")}）`}</td>
                    <td>{lbl(ROUNDING, m.proration?.rounding ?? "floor")}</td>
                  </tr>
                ))}
                <tr><td className="font-semibold">合計</td><td className="num font-semibold">{yen(total)}</td><td colSpan={3} /></tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="初月の日割り（計算式）">
        {preview.length === 0 ? (
          <p className="text-muted">契約開始日と月額費用を入力すると表示します</p>
        ) : (
          <table className="table">
            <thead><tr><th>費目</th><th>対象期間</th><th>計算式</th><th className="num">初月額</th></tr></thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.code}>
                  <td>{p.name}</td>
                  <td className="whitespace-nowrap">{p.from}〜{p.to}</td>
                  <td>{p.result?.formula ?? p.error}</td>
                  <td className="num font-semibold">{p.result ? yen(p.result.amount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function InitialTab({ c, ver }: { c: Contract; ver: ContractVersion }) {
  const total = ver.initialItems.reduce((s, m) => s + (m.amount ?? 0), 0);
  return (
    <Card
      title="初期費用"
      actions={
        ["approved", "executed", "active"].includes(c.status) && (
          <Link className="btn btn-primary btn-sm" href={`/billing/new?contractId=${c.id}&kind=initial`}>初期費用の請求を作成</Link>
        )
      }
    >
      {ver.initialItems.length === 0 ? (
        <p className="text-muted">初期費用は設定されていません</p>
      ) : (
        <table className="table">
          <thead><tr><th>費目</th><th className="num">金額</th><th>税</th></tr></thead>
          <tbody>
            {ver.initialItems.map((m, i) => (
              <tr key={i}><td>{m.name}</td><td className="num">{m.amount === null ? "未入力" : yen(m.amount)}</td><td>{taxText(m.tax)}</td></tr>
            ))}
            <tr><td className="font-semibold">合計（敷金を除く）</td><td className="num font-semibold">{yen(total)}</td><td /></tr>
          </tbody>
        </table>
      )}
      <p className="mt-3 text-sm">
        敷金（預り金・家賃収入とは区別）: {ver.depositAmount === null ? "未入力" : yen(ver.depositAmount)}／保管主体: {c.depositHolder ? lbl(DEPOSIT_HOLDER, c.depositHolder) : "未設定"}
      </p>
      {!["approved", "executed", "active"].includes(c.status) && <p className="help">初期費用の請求は社内承認後に作成できます。</p>}
    </Card>
  );
}

async function RenewalTab({ ctx, c, ver }: { ctx: Ctx; c: Contract; ver: ContractVersion }) {
  const canLease = ctx.caps.has("lease.read");
  const renewals = canLease ? await findDocs<Renewal>(ctx, C.renewals, [["contractId", "==", c.id]]) : [];
  const moveouts = canLease ? await findDocs<Moveout>(ctx, C.moveouts, [["contractId", "==", c.id]]) : [];
  const deadline = c.end ? noticeDeadlineFromRule(c.end, ver.renewal?.noticeRule) : null;
  return (
    <div className="space-y-4">
      <Card title="更新・解約の条件">
        <DL
          items={[
            ["更新後の期間", ver.renewal?.termMonths ? `${ver.renewal.termMonths}か月` : null],
            ["更新料", ver.renewal?.fee === null || ver.renewal?.fee === undefined ? null : yen(ver.renewal.fee)],
            ["更新案内の期限ルール", ruleText(ver.renewal?.noticeRule)],
            ["現在の満了日に対する案内期限", deadline],
            ["解約予告", ruleText(ver.termination?.noticeRule)?.replace("契約終了日の ", "")],
          ]}
        />
        <p className="help">期限のルールはこの契約条件に保存されています。会社設定を変更しても、この契約の期限は変わりません。</p>
      </Card>
      {!canLease ? (
        <div className="card"><StateMessage kind="forbidden" message="更新・退去の閲覧権限がありません" /></div>
      ) : (
        <>
          <Card title="更新の手続き">
            {renewals.length === 0 ? (
              <p className="text-muted">更新対象として抽出された記録はありません</p>
            ) : (
              <table className="table">
                <thead><tr><th>満了日</th><th>案内期限</th><th>状態</th></tr></thead>
                <tbody>
                  {renewals.sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1)).map((r) => (
                    <tr key={r.id}>
                      <td><Link className="text-primary hover:underline" href={`/lease/renewals/${r.id}`}>{r.expiresOn}</Link></td>
                      <td>{r.noticeDeadline ?? "—"}</td>
                      <td><Badge tone={tone(RENEWAL_STATUS, r.status)}>{lbl(RENEWAL_STATUS, r.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="解約・退去">
            {moveouts.length === 0 ? (
              <p className="text-muted">解約・退去の記録はありません</p>
            ) : (
              <table className="table">
                <thead><tr><th>申出日</th><th>確認済み解約日</th><th>状態</th></tr></thead>
                <tbody>
                  {moveouts.map((m) => (
                    <tr key={m.id}>
                      <td><Link className="text-primary hover:underline" href={`/lease/moveouts/${m.id}`}>{m.requestedAt}</Link></td>
                      <td>{m.confirmedDate ?? "未確定"}</td>
                      <td><Badge tone={tone(MOVEOUT_STATUS, m.status)}>{lbl(MOVEOUT_STATUS, m.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function PartiesTab({ ver }: { ver: ContractVersion }) {
  return (
    <Card title={`当事者（第${ver.versionNo}版の記録時点）`}>
      {ver.parties.length === 0 ? (
        <StateMessage kind="empty" message="当事者が登録されていません" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>役割</th><th>氏名・名称</th><th>読み</th><th>住所</th><th>電話</th><th>持分</th><th></th></tr></thead>
            <tbody>
              {ver.parties.map((p, i) => (
                <tr key={i}>
                  <td>{lbl(CONTRACT_PARTY_ROLE, p.role)}</td>
                  <td className="font-semibold">{p.name}{p.type === "corporation" && <span className="ml-1 text-xs text-muted">（法人）</span>}</td>
                  <td>{p.kana ?? "—"}</td>
                  <td className="max-w-72">{p.address ?? "—"}</td>
                  <td>{p.phone ?? "—"}</td>
                  <td>{p.share ?? "—"}</td>
                  <td><Link className="text-primary hover:underline" href={`/parties/${p.partyId}`}>顧客台帳</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="help">契約に記録した時点の氏名・住所です。顧客台帳を後から編集しても、ここに表示する内容は変わりません。</p>
    </Card>
  );
}

async function DocumentsTab({ ctx, c, ver, canWrite }: { ctx: Ctx; c: Contract; ver: ContractVersion; canWrite: boolean }) {
  const docs = ctx.caps.has("document.read") ? await findDocs<DocumentDoc>(ctx, C.documents, [["entity", "==", "contract"], ["entityId", "==", c.id]]) : null;
  const files = await listAttachments(ctx, "contract", c.id);
  return (
    <div className="space-y-4">
      <Card
        title="契約書類"
        actions={ctx.caps.has("document.write") && <Link className="btn btn-primary btn-sm" href={`/documents/new?entity=contract&entityId=${c.id}`}>書類を作成</Link>}
      >
        <p className="mb-3 text-sm">書類の確認: {ver.documentsChecked ? <Badge tone="ok">確認済み</Badge> : <Badge tone="warn">未確認</Badge>}</p>
        {docs === null ? (
          <StateMessage kind="forbidden" message="書類の閲覧権限がありません" />
        ) : docs.length === 0 ? (
          <p className="text-muted">作成した書類はありません（契約書・重要事項説明書は確認済みテンプレートから作成します）</p>
        ) : (
          <table className="table">
            <thead><tr><th>書類番号</th><th>件名</th><th>状態</th><th>作成日時</th></tr></thead>
            <tbody>
              {docs.filter((d) => !d.archived).map((d) => (
                <tr key={d.id}>
                  <td><Link className="text-primary hover:underline" href={`/documents/${d.id}`}>{d.number}</Link></td>
                  <td>{d.title}</td>
                  <td><Badge>{{ draft: "下書き", in_review: "社内確認中", approved: "承認済み", issued: "発行済み", superseded: "旧版" }[d.status] ?? d.status}</Badge></td>
                  <td>{formatDateTimeJst(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <h2>署名済み書類・資料</h2>
      <FileManager
        entity="contract"
        entityId={c.id}
        canWrite={canWrite}
        categories={["契約書", "重要事項説明", "本人確認", "その他"]}
        items={files.map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
      />
    </div>
  );
}

async function VersionsTab({ ctx, c, versions, canWrite }: { ctx: Ctx; c: Contract; versions: ContractVersion[]; canWrite: boolean }) {
  const names = await staffNameMap(ctx);
  const confirmed = versions.filter((v) => v.status === "confirmed");
  return (
    <div className="space-y-4">
      {canWrite && ["executed", "active"].includes(c.status) && !versions.some((v) => v.status === "draft" && v.id !== c.currentVersionId) && (
        <div><Link className="btn btn-secondary" href={`/contracts/${c.id}/change`}>条件変更（新しい版）</Link></div>
      )}
      <p className="text-sm text-muted">確定した版は変更しません。条件変更は変更開始日を持つ新しい版として保存し、前の版は変更開始日の前日で適用を終えます。将来の未確定の請求のみが再計算の対象になります。</p>
      {[...versions].reverse().map((v) => {
        const prev = v.status === "confirmed" ? [...confirmed].reverse().find((x) => x.versionNo < v.versionNo) : confirmed[confirmed.length - 1];
        const diff = prev ? versionAmountDiff(prev, v) : [];
        const isCurrent = v.id === c.currentVersionId;
        return (
          <Card
            key={v.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                第{v.versionNo}版
                <Badge tone={tone(VERSION_STATUS, v.status)}>{lbl(VERSION_STATUS, v.status)}</Badge>
                {isCurrent && <Badge tone="info">現在の条件</Badge>}
              </span>
            }
            actions={
              canWrite && v.status === "draft" && !isCurrent && (
                <>
                  <Link className="btn btn-primary btn-sm" href={`/contracts/${c.id}/edit?versionId=${v.id}`}>編集・確定</Link>
                  <ActionButton size="sm" action={discardChangeVersion} args={{ versionId: v.id }} label="破棄" prompt="破棄する理由を入力してください" />
                </>
              )
            }
          >
            <DL
              items={[
                ["適用期間", `${v.effectiveFrom}〜${v.effectiveTo ?? ""}`],
                ["変更理由", v.changeReason],
                ["確定者", v.confirmedBy ? `${names.get(v.confirmedBy) ?? "—"}（${formatDateTimeJst(v.confirmedAt)}）` : null],
                ["作成", `${names.get(v.createdBy) ?? (v.createdBy === "system" ? "定期処理" : "—")}（${formatDateTimeJst(v.createdAt)}）`],
              ]}
            />
            {prev && (
              <div className="mt-3">
                <p className="text-sm font-semibold">第{prev.versionNo}版からの変更</p>
                {diff.length === 0 ? (
                  <p className="text-sm text-muted">金額・期間の変更はありません</p>
                ) : (
                  <table className="table mt-1">
                    <thead><tr><th>項目</th><th className="num">変更前</th><th className="num">変更後</th><th className="num">差額</th></tr></thead>
                    <tbody>
                      {diff.map((d, i) => (
                        <tr key={i}>
                          <td>{d.label}</td>
                          <td className="num">{typeof d.before === "number" ? yen(d.before) : d.before ?? "未入力"}</td>
                          <td className="num">{typeof d.after === "number" ? yen(d.after) : d.after ?? "未入力"}</td>
                          <td className="num">{d.delta === null ? "—" : `${d.delta > 0 ? "+" : ""}${d.delta.toLocaleString()}円`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

async function DepositTab({ ctx, c, ver }: { ctx: Ctx; c: Contract; ver: ContractVersion }) {
  const entries = await findDocs<DepositEntryDoc>(ctx, C.deposits, [["contractId", "==", c.id]]);
  const files = await listAttachments(ctx, "contract", c.id);
  return (
    <DepositPanel
      contractId={c.id}
      moveoutId={null}
      entries={entries}
      depositAmount={ver.depositAmount}
      defaultHolder={c.depositHolder}
      canWrite={ctx.caps.has("lease.write") || ctx.caps.has("contract.write")}
      canApprove={ctx.caps.has("contract.approve") || ctx.caps.has("billing.confirm")}
      attachments={files.map((f) => ({ value: f.id, label: f.fileName }))}
      today={todayJst()}
      names={await staffNameMap(ctx)}
    />
  );
}

async function ApprovalsTab({ ctx, c }: { ctx: Ctx; c: Contract }) {
  const list = [...(c.approvals ?? [])].reverse();
  return (
    <Card title="社内承認の履歴">
      <p className="mb-3 text-sm text-muted">社内での確認・承認・差戻しの記録です。外部の電子署名による契約締結とは別の記録です。</p>
      {list.length === 0 ? (
        <p className="text-muted">まだ記録はありません</p>
      ) : (
        <table className="table">
          <thead><tr><th>日時</th><th>操作</th><th>実施者</th><th>理由・内容</th></tr></thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap">{formatDateTimeJst(a.at)}</td>
                <td><Badge tone={tone(APPROVAL_ACTION, a.action)}>{lbl(APPROVAL_ACTION, a.action)}</Badge></td>
                <td>{a.byName}</td>
                <td className="whitespace-pre-wrap">{a.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.overlapException && (
        <p className="mt-3 text-sm">期間重複の例外（管理者）: {c.overlapException.reason}（{await staffName(ctx, c.overlapException.approvedBy)}・{formatDateTimeJst(c.overlapException.at)}）</p>
      )}
      {c.executedAt && <p className="mt-2 text-sm">締結記録: {c.executedAt}（確認者: {await staffName(ctx, c.executedBy)}）</p>}
    </Card>
  );
}
