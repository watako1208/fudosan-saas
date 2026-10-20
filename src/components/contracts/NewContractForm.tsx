"use client";
import { EditForm, FormSection } from "@/components/EditForm";
import { createContract } from "@/lib/server/actions/contracts";
import { UnitField, PropertiesField } from "./RefPickers";

/** 新規契約: 部屋（賃貸）または物件（売買）と案件を指定して下書きを作成する（条件は自動で引き継ぐ） */
export function NewContractForm({
  kind,
  dealId,
  unitId,
  unitLabel,
  propertyIds,
  propertyLabels,
}: {
  kind: "lease" | "sale";
  dealId: string | null;
  unitId: string | null;
  unitLabel: string | null;
  propertyIds: string[];
  propertyLabels: Record<string, string>;
}) {
  return (
    <EditForm
      action={createContract}
      initial={{ unitId, propertyIds }}
      cancelHref="/contracts"
      buttons={[{ label: "下書きを作成", intent: "create", primary: true }]}
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="dealId" value={dealId ?? ""} />
      <FormSection
        title={kind === "lease" ? "対象の部屋" : "対象の土地・建物"}
        desc={
          kind === "lease"
            ? "部屋を選ぶと、現在の募集条件（賃料・共益費・敷金・礼金）と所有者（貸主）を下書きへ引き継ぎます。後から募集条件を変更しても、この契約の条件は変わりません。"
            : "物件を選ぶと、現在の売買募集価格と所有者（売主）を下書きへ引き継ぎます。"
        }
      >
        {kind === "lease" ? <UnitField initialLabel={unitLabel} /> : <PropertiesField initialLabels={propertyLabels} />}
      </FormSection>
    </EditForm>
  );
}
