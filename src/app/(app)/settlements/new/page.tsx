import { requireStaffPage } from "@/lib/server/session";
import { findDocs, getMany } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { createSettlement } from "@/lib/server/actions/settlements";
import { C, Ownership, Party } from "@/lib/types";
import { PageHeader, StateMessage } from "@/components/ui";
import { EditForm, FormSection, SelectField } from "@/components/EditForm";
import { addPeriod } from "@/lib/domain/billing";
import { todayJst } from "@/lib/domain/dates";

export const metadata = { title: "精算の作成" };

export default async function NewSettlementPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("settlement.write");
  const sp = await searchParams;
  const owns = (await findDocs<Ownership>(ctx, C.ownerships, [["archived", "==", false]], 5000));
  const parties = await getMany<Party>(ctx, C.parties, owns.map((o) => o.partyId));
  const options = [...parties.values()].sort((a, b) => (a.kana ?? a.name).localeCompare(b.kana ?? b.name, "ja")).map((p) => ({ value: p.id, label: `${p.name}${p.number ? `（${p.number}）` : ""}` }));
  const thisMonth = todayJst().slice(0, 7);
  const periods = Array.from({ length: 13 }, (_, i) => addPeriod(thisMonth, -i));
  return (
    <>
      <PageHeader title="オーナー精算を作成" sub="対象月に有効な所有関係の物件について、まだ精算していない回収済みの入金配分（入金日が対象月末以前）を集計します。" />
      {options.length === 0 ? (
        <div className="card"><StateMessage kind="empty" message="所有関係（オーナー）が登録された物件がありません。物件の「所有者・管理」から登録してください。" /></div>
      ) : (
        <EditForm
          action={createSettlement}
          initial={{ ownerPartyId: typeof sp.owner === "string" ? sp.owner : "", period: typeof sp.period === "string" ? sp.period : addPeriod(thisMonth, -1) }}
          cancelHref="/settlements"
          buttons={[{ label: "計算して作成", intent: "create", primary: true }]}
          fieldLabels={{ ownerPartyId: "オーナー", period: "対象月" }}
        >
          <FormSection title="精算の対象">
            <SelectField name="ownerPartyId" label="オーナー" required options={options} />
            <SelectField name="period" label="対象月" required options={periods.map((p) => ({ value: p, label: p }))} allowEmpty={false} />
          </FormSection>
        </EditForm>
      )}
    </>
  );
}
