import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffPage } from "@/lib/server/session";
import { getDoc, getMany, findDocs } from "@/lib/server/repo";
import { SP } from "@/lib/server/query";
import { staffOptions, itemTypes } from "@/lib/server/lookups";
import { saveContractVersion } from "@/lib/server/actions/contracts";
import { C, Contract, ContractVersion, Unit, Property } from "@/lib/types";
import { PageHeader, Card, StateMessage } from "@/components/ui";
import { ContractForm } from "@/components/contracts/ContractForm";
import { versionToForm, itemTypeOptions } from "@/components/contracts/formValues";

export default async function EditContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("contract.write");
  const { id } = await params;
  const sp = await searchParams;
  const c = await getDoc<Contract>(ctx, C.contracts, id);
  if (!c) notFound();
  const versions = await findDocs<ContractVersion>(ctx, C.contractVersions, [["contractId", "==", id]]);
  const requested = typeof sp.versionId === "string" ? sp.versionId : null;
  const ver =
    versions.find((v) => v.id === requested) ??
    (c.status === "draft" ? versions.find((v) => v.id === c.currentVersionId) : versions.find((v) => v.status === "draft" && !v.archived && v.id !== c.currentVersionId));
  const back = `/contracts/${id}`;

  if (!ver || ver.archived || ver.status === "confirmed" || (ver.id === c.currentVersionId && c.status !== "draft")) {
    return (
      <>
        <PageHeader title={`契約の編集: ${c.title}`} sub={c.number} />
        <Card>
          <StateMessage
            kind="empty"
            message={
              c.status === "in_review"
                ? "社内確認中の契約は編集できません。差戻し後に編集してください。"
                : "確定済みの契約条件は直接変更できません。条件を変える場合は「条件変更（新しい版）」を作成してください。"
            }
            action={<Link href={`${back}?tab=versions`} className="btn btn-secondary">版履歴へ</Link>}
          />
        </Card>
      </>
    );
  }

  const mode = ver.id === c.currentVersionId ? "initial" : "change";
  const unit = c.unitId ? await getDoc<Unit>(ctx, C.units, c.unitId) : null;
  const props = await getMany<Property>(ctx, C.properties, [...(c.propertyIds ?? []), unit?.propertyId ?? ""]);
  return (
    <>
      <PageHeader
        title={mode === "initial" ? `契約の編集: ${c.title}` : `条件変更（第${ver.versionNo}版）: ${c.title}`}
        sub={`${c.number}・下書きは未入力の項目があっても保存できます。提出・確定時に必要項目を検証します。`}
      />
      <ContractForm
        kind={c.kind === "sale" ? "sale" : "lease"}
        mode={mode}
        action={saveContractVersion.bind(null, id, ver.id)}
        initial={versionToForm(c, ver)}
        version={ver.version}
        contractVersion={c.version}
        cancelHref={back}
        staff={await staffOptions(ctx)}
        itemTypes={itemTypeOptions(await itemTypes(ctx.companyId))}
        unitLabel={unit ? `${props.get(unit.propertyId)?.name ?? ""} ${unit.number}` : null}
        propertyLabels={Object.fromEntries([...props.values()].map((p) => [p.id, p.name]))}
        canApprove={ctx.caps.has("contract.approve")}
      />
    </>
  );
}
