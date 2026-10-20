import { requireExternalPage } from "@/lib/server/portal-access";
import { getMany } from "@/lib/server/repo";
import { submitPortalInquiry } from "@/lib/server/actions/portal";
import { C, Inquiry, Unit, Property } from "@/lib/types";
import { Card, Badge, StateMessage } from "@/components/ui";
import { NoScope, NotForYou } from "@/components/portal/Guard";
import { MiniForm } from "@/components/support/MiniForm";
import { INQUIRY_STATUS, INQUIRY_CATEGORY, opts, lbl, tone } from "@/lib/labels-support";
import { formatDateTimeJst } from "@/lib/domain/dates";

export const metadata = { title: "問い合わせ・申請" };

export default async function PortalInquiries() {
  const { ctx, scope } = await requireExternalPage();
  if (!scope) return <NoScope />;
  if (scope.kind !== "tenant" && scope.kind !== "owner") return <NotForYou />;
  const inqs = [...(await getMany<Inquiry>(ctx, C.inquiries, [...scope.inquiryIds].slice(0, 300))).values()]
    .filter((i) => i.partyId === scope.partyId && !i.archived)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const units = scope.kind === "tenant" ? [...(await getMany<Unit>(ctx, C.units, [...scope.unitIds])).values()] : [];
  const props = await getMany<Property>(ctx, C.properties, scope.kind === "owner" ? [...scope.propertyIds] : units.map((u) => u.propertyId));
  return (
    <>
      <h1 className="mb-4">問い合わせ・申請</h1>
      <Card title="新しく問い合わせる">
        <MiniForm action={submitPortalInquiry} submitLabel="送信する" successMessage="受け付けました。担当者が確認します。">
          <div className="grid gap-3 sm:grid-cols-2">
            {scope.kind === "tenant" ? (
              <label className="block">
                <span className="label">お部屋</span>
                <select name="unitId" className="input">
                  {units.map((u) => <option key={u.id} value={u.id}>{props.get(u.propertyId)?.name ?? ""} {u.number}</option>)}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="label">物件</span>
                <select name="propertyId" className="input">
                  <option value="">（特定の物件ではない）</option>
                  {[...props.values()].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="label">分類</span>
              <select name="category" className="input" defaultValue="equipment">
                {opts(INQUIRY_CATEGORY).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">緊急度</span>
              <select name="urgency" className="input" defaultValue="normal">
                <option value="normal">通常</option>
                <option value="high">早めの対応を希望</option>
                <option value="emergency">緊急（漏水・鍵の紛失など）</option>
                <option value="low">急ぎではない</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="label">内容<span className="ml-1 text-xs text-danger">必須</span></span>
              <textarea name="content" rows={5} className="input" placeholder="いつから・どこで・どのような状態か" />
            </label>
          </div>
          <p className="help">緊急の場合（漏水など）は、お電話でもご連絡ください。</p>
        </MiniForm>
      </Card>
      <Card title="これまでの問い合わせ" className="mt-4">
        {inqs.length === 0 ? (
          <StateMessage kind="empty" message="問い合わせはまだありません" />
        ) : (
          <ul className="divide-y divide-line">
            {inqs.map((i) => (
              <li key={i.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={tone(INQUIRY_STATUS, i.status)}>{lbl(INQUIRY_STATUS, i.status)}</Badge>
                  <span className="text-sm text-muted">{i.number} ／ {formatDateTimeJst(i.receivedAt)} ／ {lbl(INQUIRY_CATEGORY, i.category)}</span>
                </div>
                <p className="mt-1 line-clamp-3 break-words whitespace-pre-wrap">{i.content}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
