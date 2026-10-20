import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc } from "@/lib/server/repo";
import { staffName } from "@/lib/server/lookups";
import { confirmRenewal, cancelRenewal } from "@/lib/server/actions/lease";
import { C, Renewal, Contract, ContractVersion } from "@/lib/types";
import { DetailHeader, Card, DL, Badge } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { Steps } from "@/components/lease/Steps";
import { RenewalForm } from "@/components/lease/LeaseForms";
import { lbl, tone } from "@/lib/labels";
import { RENEWAL_STATUS, RENEWAL_ANSWER, RENEWAL_STEPS, HOLIDAY_ADJUST } from "@/lib/labels-contracts";
import { renewedPeriod } from "@/lib/domain/contracts";
import { yen } from "@/lib/domain/money";
import { formatDateTimeJst } from "@/lib/domain/dates";

export default async function RenewalDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("lease.read");
  const { id } = await params;
  const r = await getDoc<Renewal>(ctx, C.renewals, id);
  if (!r) notFound();
  const c = await getDoc<Contract>(ctx, C.contracts, r.contractId);
  if (!c) notFound();
  const ver = c.currentVersionId ? await getDoc<ContractVersion>(ctx, C.contractVersions, c.currentVersionId) : null;
  const canWrite = ctx.caps.has("lease.write");
  const editable = ["extracted", "notified", "answered", "documents"].includes(r.status);
  const rentItem = ver?.monthlyItems.find((m) => ["rent", "rent_commercial", "parking"].includes(m.code));
  const termMonths = r.proposedTerms?.termMonths ?? ver?.renewal?.termMonths ?? null;
  const next = termMonths ? renewedPeriod(r.expiresOn, termMonths) : null;
  const rule = ver?.renewal?.noticeRule;
  const cancelReason = (r as Renewal & { cancelReason?: string }).cancelReason;

  return (
    <>
      <DetailHeader
        back={{ href: "/lease?tab=renewals", label: "更新管理" }}
        number={`${c.number}・満了 ${r.expiresOn}`}
        title={`更新: ${c.title}`}
        badges={
          <>
            <Badge tone={tone(RENEWAL_STATUS, r.status)}>{lbl(RENEWAL_STATUS, r.status)}</Badge>
            <Badge tone={tone(RENEWAL_ANSWER, r.answer)}>回答: {lbl(RENEWAL_ANSWER, r.answer)}</Badge>
          </>
        }
        meta={
          <>
            <span>担当: {await staffName(ctx, c.assigneeUid)}</span>
            <span>案内期限: {r.noticeDeadline ?? "ルール未設定"}</span>
            <Link className="text-primary hover:underline" href={`/contracts/${c.id}?tab=renewal`}>契約を表示</Link>
          </>
        }
        actions={
          canWrite &&
          editable && (
            <>
              <ActionButton
                action={confirmRenewal}
                args={{ id }}
                variant="primary"
                label="更新を確定"
                disabled={r.answer !== "accept"}
                disabledReason="借主の回答が「更新する」の場合に確定できます"
                confirm={`提示条件で契約を更新し、新しい契約版（${next ? `${next.effectiveFrom}〜${next.newEnd}` : "期間未設定"}）を作成します。よろしいですか？`}
              />
              <ActionButton action={cancelRenewal} args={{ id }} label="対象外・中止" prompt="中止理由を入力してください（例: 借主から解約の申出）" variant="ghost" />
            </>
          )
        }
      />
      <Steps steps={RENEWAL_STEPS.map((k) => ({ key: k, label: lbl(RENEWAL_STATUS, k) }))} current={r.status} />
      {r.status === "cancelled" && <p className="mb-4 rounded-md border border-line bg-surface p-3 text-sm">中止理由: {cancelReason ?? "—"}</p>}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="現在の契約条件">
          <DL
            items={[
              ["契約期間", `${c.start ?? "未定"}〜${c.end ?? ""}`],
              ["賃料", rentItem ? yen(rentItem.amount) : null],
              ["更新後の期間（契約条件）", ver?.renewal?.termMonths ? `${ver.renewal.termMonths}か月` : null],
              ["更新料（契約条件）", ver?.renewal?.fee === null || ver?.renewal?.fee === undefined ? null : yen(ver.renewal.fee)],
              ["案内期限のルール", rule ? `満了日の${rule.amount}${rule.unit === "months" ? "か月前" : "日前"}（${lbl(HOLIDAY_ADJUST, rule.holidayAdjust)}）` : null],
            ]}
          />
          <p className="help">案内期限は契約条件に保存したルールから計算しています（会社設定の変更では変わりません）。</p>
        </Card>
        <Card title="更新後の予定">
          <DL
            items={[
              ["更新後の期間", next ? `${next.effectiveFrom}〜${next.newEnd}` : "更新期間（か月）が未設定です"],
              ["更新後の賃料", r.proposedTerms?.rent !== null && r.proposedTerms?.rent !== undefined ? yen(r.proposedTerms.rent) : rentItem ? `${yen(rentItem.amount)}（据え置き）` : null],
              ["更新料", r.proposedTerms?.fee !== null && r.proposedTerms?.fee !== undefined ? yen(r.proposedTerms.fee) : null],
              ["作成した契約版", r.newVersionId ? <Link key="v" className="text-primary hover:underline" href={`/contracts/${c.id}?tab=versions`}>版履歴で確認</Link> : "未作成（確定前）"],
              ["抽出日時", formatDateTimeJst(r.createdAt)],
            ]}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {ctx.caps.has("document.write") && <Link className="btn btn-secondary btn-sm" href={`/documents/new?entity=renewal&entityId=${id}&docType=renewal_notice`}>更新案内を作成</Link>}
            {ctx.caps.has("billing.write") && <Link className="btn btn-secondary btn-sm" href={`/billing/new?contractId=${c.id}&kind=one_time&item=renewal_fee`}>更新料の請求を作成</Link>}
          </div>
        </Card>
      </div>
      {canWrite && editable ? (
        <RenewalForm
          id={id}
          version={r.version}
          initial={{
            answer: r.answer,
            status: r.status,
            proposedRent: r.proposedTerms?.rent ?? null,
            proposedFee: r.proposedTerms?.fee ?? ver?.renewal?.fee ?? null,
            proposedTermMonths: r.proposedTerms?.termMonths ?? ver?.renewal?.termMonths ?? null,
            proposedNote: r.proposedTerms?.note ?? null,
          }}
        />
      ) : (
        <Card title="提示条件・回答">
          <DL
            items={[
              ["提示賃料", r.proposedTerms?.rent === null || r.proposedTerms?.rent === undefined ? null : yen(r.proposedTerms.rent)],
              ["提示更新料", r.proposedTerms?.fee === null || r.proposedTerms?.fee === undefined ? null : yen(r.proposedTerms.fee)],
              ["提示期間", r.proposedTerms?.termMonths ? `${r.proposedTerms.termMonths}か月` : null],
              ["備考", r.proposedTerms?.note ?? null],
              ["回答", lbl(RENEWAL_ANSWER, r.answer)],
            ]}
          />
        </Card>
      )}
    </>
  );
}
