import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, findDocs, getMany } from "@/lib/server/repo";
import { staffNameMap } from "@/lib/server/lookups";
import { listAttachments } from "@/lib/server/attachments";
import { repairExpenseCandidates, itemTypeList, isLocked, SettlementExtra } from "@/lib/server/jobs/billing";
import {
  submitSettlement, backToCalculating, confirmSettlement, addRemittance, setSettlementPublished, createSettlementCorrection, saveSettlementInputs,
} from "@/lib/server/actions/settlements";
import { C, Party, Property, Remittance, Settlement } from "@/lib/types";
import { DetailHeader, Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { FileManager } from "@/components/FileManager";
import { InlineForm, Input, Select } from "@/components/billing/InlineForm";
import { SettlementInputs } from "@/components/billing/SettlementInputs";
import { SETTLEMENT_STATUS } from "@/lib/labels-billing";
import { lbl, tone } from "@/lib/labels";
import { formatDateTimeJst, todayJst } from "@/lib/domain/dates";
import { yen } from "@/lib/domain/money";
import Decimal from "decimal.js";

type SettlementDoc = Settlement & SettlementExtra;

export default async function SettlementDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaffPage("settlement.read");
  const { id } = await params;
  const s = await getDoc<SettlementDoc>(ctx, C.settlements, id);
  if (!s) notFound();
  const owner = await getDoc<Party>(ctx, C.parties, s.ownerPartyId);
  const props = await getMany<Property>(ctx, C.properties, s.propertyIds);
  const ownerNames = await getMany<Party>(ctx, C.parties, s.ownerSplit.map((o) => o.ownerId));
  const remits = (await findDocs<Remittance>(ctx, C.remittances, [["settlementId", "==", id]], 200)).sort((a, b) => a.date.localeCompare(b.date));
  const names = await staffNameMap(ctx);
  const types = await itemTypeList(ctx);
  const typeName = (code: string) => types.find((t) => t.code === code)?.name ?? code;
  const canWrite = ctx.caps.has("settlement.write");
  const canConfirm = ctx.caps.has("settlement.confirm");
  const locked = await isLocked(ctx, s.period);
  const files = await listAttachments(ctx, "settlement", id);
  const confirmed = ["confirmed", "partially_remitted", "remitted", "corrected"].includes(s.status);
  const candidates = s.status === "calculating" && canWrite ? await repairExpenseCandidates(ctx, s.propertyIds, id) : [];
  const payable = s.calc?.payable ?? 0;
  const original = s.correctionOf ? await getDoc<Settlement>(ctx, C.settlements, s.correctionOf) : null;
  const correction = s.correctedBy ? await getDoc<Settlement>(ctx, C.settlements, s.correctedBy) : null;

  // 費目・物件別の回収内訳
  const byKey = new Map<string, { propertyId: string; itemCode: string; amount: number; allocs: Set<string> }>();
  for (const r of s.collectedDetail ?? []) {
    const k = `${r.propertyId}|${r.itemCode}`;
    const g = byKey.get(k) ?? { propertyId: r.propertyId, itemCode: r.itemCode, amount: 0, allocs: new Set<string>() };
    g.amount += r.amount;
    g.allocs.add(r.allocationId);
    byKey.set(k, g);
  }
  const remittedBy = new Map<string, number>();
  for (const r of remits) remittedBy.set(r.ownerPartyId, (remittedBy.get(r.ownerPartyId) ?? 0) + r.amount);

  return (
    <>
      <DetailHeader
        back={{ href: "/settlements", label: "オーナー精算一覧" }}
        number={s.number}
        title={`${owner?.name ?? "（不明なオーナー）"} ${s.period}`}
        badges={
          <>
            <Badge tone={tone(SETTLEMENT_STATUS, s.status)}>{lbl(SETTLEMENT_STATUS, s.status)}</Badge>
            {s.correctionOf && <Badge>訂正精算</Badge>}
            {s.publishedToOwner ? <Badge tone="info">オーナー公開中</Badge> : <Badge>非公開</Badge>}
            {locked && <Badge>締め済み期間</Badge>}
          </>
        }
        meta={
          <>
            <span>送金予定 {yen(s.calc?.payable ?? null)}</span>
            <span>送金記録 {yen(s.remitted)}</span>
            <span>差額 {yen(payable - s.remitted)}</span>
            {s.confirmedAt && <span>確定 {formatDateTimeJst(s.confirmedAt)} {names.get(s.confirmedBy ?? "") ?? ""}</span>}
          </>
        }
        actions={
          <>
            {s.status === "calculating" && canWrite && !locked && <ActionButton action={submitSettlement} args={{ id }} label="確認へ進める" variant="primary" confirm="計算結果を確認待ちにします。" />}
            {s.status === "review" && canWrite && <ActionButton action={backToCalculating} args={{ id }} label="計算中に戻す" prompt="戻す理由を入力してください" />}
            {s.status === "review" && canConfirm && !locked && (
              <ActionButton
                action={confirmSettlement}
                args={{ id }}
                label="確定"
                variant="primary"
                confirm={`対象入金 ${s.allocationIds.length}件・送金予定 ${payable.toLocaleString()}円で確定します。確定した入金は他の精算で使用できなくなります。`}
              />
            )}
            {confirmed && s.status !== "corrected" && canConfirm && (
              <ActionButton action={setSettlementPublished} args={{ id, publish: !s.publishedToOwner }} label={s.publishedToOwner ? "オーナー公開を停止" : "オーナーページに公開"} confirm={s.publishedToOwner ? "オーナーページへの公開を停止します。" : "この精算書をオーナーページに公開します。"} />
            )}
            {confirmed && s.status !== "corrected" && canWrite && !s.correctedBy && (
              <ActionButton action={createSettlementCorrection} args={{ id }} label="訂正精算を作成" prompt="訂正の理由を入力してください" />
            )}
            <Link href={`/settlements/${id}/print`} className="btn btn-secondary">印刷・PDF</Link>
            {confirmed && <Link href={`/documents/new?entity=settlement&entityId=${id}&docType=owner_report`} className="btn btn-secondary">収支報告書を作成</Link>}
          </>
        }
      />
      <div className="space-y-4">
        {(original || correction) && (
          <Card title="訂正の関係">
            {original && <p>元の精算: <Link className="text-primary hover:underline" href={`/settlements/${original.id}`}>{original.number}</Link>（{lbl(SETTLEMENT_STATUS, original.status)}）</p>}
            {correction && <p>訂正精算: <Link className="text-primary hover:underline" href={`/settlements/${correction.id}`}>{correction.number}</Link>（{lbl(SETTLEMENT_STATUS, correction.status)}）</p>}
            {s.note && <p className="text-sm text-muted">{s.note}</p>}
          </Card>
        )}

        <Card title="計算結果">
          {!s.calc ? (
            <StateMessage kind="error" message="計算結果がありません。再計算してください。" />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <table className="table">
                <tbody>
                  <tr><th>回収済み家賃等</th><td className="num">{yen(s.calc.collectedTotal)}</td></tr>
                  <tr><th>管理料（対象額 {yen(s.calc.feeBase)}）</th><td className="num">− {yen(s.calc.fee)}</td></tr>
                  <tr><th>管理料消費税</th><td className="num">− {yen(s.calc.feeTax)}</td></tr>
                  <tr><th>立替費用</th><td className="num">− {yen(s.calc.expenses)}</td></tr>
                  <tr><th>前回繰越</th><td className="num">{yen(s.calc.carryIn)}</td></tr>
                  <tr className="font-semibold"><th>送金予定額</th><td className="num">{yen(s.calc.payable)}</td></tr>
                  {s.calc.carryOut < 0 && <tr><th>次回へ繰越</th><td className="num">{yen(s.calc.carryOut)}</td></tr>}
                  {!!s.depositTotal && <tr><th>預り金（収入に含めない）</th><td className="num">{yen(s.depositTotal)}</td></tr>}
                </tbody>
              </table>
              <div>
                <p className="label">計算根拠</p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {s.calc.basis.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
                <p className="help mt-2">対象: 入金日が {s.period} 末日以前で、まだ精算に含まれていない入金配分 {s.allocationIds.length}件。請求しただけの未回収額は含みません。</p>
              </div>
            </div>
          )}
        </Card>

        <Card title="回収内訳（物件・費目別）">
          {byKey.size === 0 ? (
            <StateMessage kind="empty" message="対象となる回収済みの入金がありません" />
          ) : (
            <table className="table">
              <thead><tr><th>物件</th><th>費目</th><th className="num">回収額</th><th className="num">入金配分</th></tr></thead>
              <tbody>
                {[...byKey.values()].map((g) => (
                  <tr key={`${g.propertyId}|${g.itemCode}`}>
                    <td>{props.get(g.propertyId)?.name ?? g.propertyId}</td>
                    <td>{typeName(g.itemCode)}</td>
                    <td className="num">{yen(g.amount)}</td>
                    <td className="num">{g.allocs.size}件</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="送金配分（共有所有者）">
          <table className="table">
            <thead><tr><th>送金先</th><th>配分率</th><th className="num">送金予定</th><th className="num">送金記録</th><th className="num">差額</th></tr></thead>
            <tbody>
              {s.ownerSplit.map((o) => {
                const share = s.ownerShares?.find((x) => x.ownerId === o.ownerId);
                const done = remittedBy.get(o.ownerId) ?? 0;
                return (
                  <tr key={o.ownerId}>
                    <td>{ownerNames.get(o.ownerId)?.name ?? share?.name ?? "（不明）"}{s.remainderTo === o.ownerId && s.ownerSplit.length > 1 && <span className="ml-1 text-xs text-muted">（端数受取）</span>}</td>
                    <td>{share ? `${new Decimal(share.ratio).mul(100).toDecimalPlaces(4).toString()}%` : "—"}</td>
                    <td className="num">{yen(o.amount)}</td>
                    <td className="num">{yen(done)}</td>
                    <td className={`num ${o.amount - done !== 0 && confirmed ? "font-semibold" : ""}`}>{yen(o.amount - done)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        {s.status === "calculating" && canWrite && (
          <Card
            title="立替費用・繰越（計算中）"
            actions={<ActionButton action={saveSettlementInputs} args={{ id }} label="入金を読み直して再計算" size="sm" />}
          >
            {locked ? (
              <p className="text-muted">締め済み期間のため変更できません。</p>
            ) : (
              <SettlementInputs
                id={id}
                version={s.version}
                expenses={s.expenses}
                carryIn={s.carryIn}
                note={s.note ?? null}
                candidates={candidates.map((c) => ({ repairId: c.repairId, name: c.name, amount: c.amount, completedAt: c.completedAt }))}
                allowNegative={!!s.correctionOf}
              />
            )}
          </Card>
        )}
        {s.status !== "calculating" && s.expenses.length > 0 && (
          <Card title="立替費用">
            <table className="table">
              <tbody>
                {s.expenses.map((e, i) => (
                  <tr key={i}><td>{e.name}</td><td className="num">{yen(e.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <Card title="送金記録（予定額と実行記録の差額）">
          <p className="mb-3 text-sm">
            送金予定 <b>{yen(payable)}</b> ／ 実行記録 <b>{yen(s.remitted)}</b> ／ 差額 <b>{yen(payable - s.remitted)}</b>
            {confirmed && payable - s.remitted !== 0 && <span className="ml-2"><Badge tone="warn">差額あり（確認待ち）</Badge></span>}
          </p>
          {remits.length > 0 && (
            <table className="table mb-4">
              <thead><tr><th>送金日</th><th>送金先</th><th className="num">金額</th><th>資料</th><th>メモ</th><th>登録</th></tr></thead>
              <tbody>
                {remits.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{ownerNames.get(r.ownerPartyId)?.name ?? "—"}</td>
                    <td className="num">{yen(r.amount)}</td>
                    <td>{r.attachmentId ? <a className="text-primary hover:underline" href={`/api/files/${r.attachmentId}`} target="_blank" rel="noreferrer">{files.find((f) => f.id === r.attachmentId)?.fileName ?? "資料"}</a> : "—"}</td>
                    <td>{r.note ?? "—"}</td>
                    <td className="text-sm">{formatDateTimeJst(r.createdAt)} {names.get(r.createdBy) ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {["confirmed", "partially_remitted"].includes(s.status) && canWrite && (
            <InlineForm action={addRemittance} hidden={{ settlementId: id }} submitLabel="送金記録を登録" successMessage="登録しました" confirm="外部で実行した送金の記録を登録します。">
              <p className="text-sm text-muted">送金自体は銀行等で行い、実行日・金額・控え資料を記録します。控えは下の「送金資料」に登録してから選択してください。</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Input name="date" label="送金日" type="date" required defaultValue={todayJst()} />
                <Input name="amount" label="金額（円）" required inputMode="numeric" defaultValue={Math.max(payable - s.remitted, 0)} />
                {s.ownerSplit.length > 1 ? (
                  <Select name="ownerPartyId" label="送金先" required options={s.ownerSplit.map((o) => ({ value: o.ownerId, label: ownerNames.get(o.ownerId)?.name ?? o.ownerId }))} />
                ) : (
                  <input type="hidden" name="ownerPartyId" value={s.ownerPartyId} />
                )}
                <Select name="attachmentId" label="送金資料" emptyLabel="なし" options={files.map((f) => ({ value: f.id, label: f.fileName }))} />
                <Input name="note" label="メモ" />
              </div>
            </InlineForm>
          )}
        </Card>

        <Card title="送金資料・精算資料">
          <FileManager
            entity="settlement"
            entityId={id}
            canWrite={canWrite}
            categories={["送金控え", "精算書", "請求書・領収書", "その他"]}
            items={files.map(({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }) => ({ id, fileName, contentType, category, description, visibility, takenAt, sort, size, sensitive }))}
          />
        </Card>
      </div>
    </>
  );
}
