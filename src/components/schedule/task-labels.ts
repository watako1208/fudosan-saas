import "server-only";
import { getMany } from "@/lib/server/repo";
import type { Ctx } from "@/lib/server/session";
import { C, TaskDoc, Deal, Party, Property, Contract } from "@/lib/types";

/** タスクの関連先の表示名（閲覧権限のある関連先のみ） */
export async function entityLabels(ctx: Ctx, tasks: Pick<TaskDoc, "entity" | "entityId">[]): Promise<Map<string, string>> {
  const ids = (e: string) => tasks.filter((t) => t.entity === e && t.entityId).map((t) => t.entityId!);
  const out = new Map<string, string>();
  const [deals, parties, props, contracts] = await Promise.all([
    ctx.caps.has("deal.read") ? getMany<Deal>(ctx, C.deals, ids("deal")) : new Map<string, Deal>(),
    ctx.caps.has("party.read") ? getMany<Party>(ctx, C.parties, ids("party")) : new Map<string, Party>(),
    ctx.caps.has("property.read") ? getMany<Property>(ctx, C.properties, ids("property")) : new Map<string, Property>(),
    ctx.caps.has("contract.read") ? getMany<Contract>(ctx, C.contracts, ids("contract")) : new Map<string, Contract>(),
  ]);
  deals.forEach((d) => out.set(`deal:${d.id}`, `案件 ${d.number} ${d.title}`));
  parties.forEach((p) => out.set(`party:${p.id}`, `顧客 ${p.name}`));
  props.forEach((p) => out.set(`property:${p.id}`, `物件 ${p.name}`));
  contracts.forEach((c) => out.set(`contract:${c.id}`, `契約 ${c.number}`));
  return out;
}
