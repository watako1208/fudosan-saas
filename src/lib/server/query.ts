import "server-only";
import type { ListOpts, Where } from "./repo";

export type SP = Record<string, string | string[] | undefined>;

/** 一覧画面の URL パラメータ → listDocs のオプション */
export function listOptsFromSearch(sp: SP, allowedSort: string[], filterKeys: string[] = [], defaultSort = "updatedAt"): ListOpts & { filtered: boolean } {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const where: Where[] = [];
  for (const k of filterKeys) {
    const v = g(k);
    if (v) where.push([k, "==", v === "__null" ? null : v]);
  }
  const sort = g("sort");
  const q = g("q");
  return {
    where,
    search: q,
    orderBy: sort && allowedSort.includes(sort) ? sort : defaultSort,
    dir: g("dir") === "asc" ? "asc" : "desc",
    page: Number(g("page") ?? 1) || 1,
    pageSize: Number(g("size") ?? 50) || 50,
    includeArchived: g("archived") === "1",
    filtered: !!q || where.length > 0,
  };
}

export function tabOf(sp: SP, allowed: string[], def: string): string {
  const t = typeof sp.tab === "string" ? sp.tab : def;
  return allowed.includes(t) ? t : def;
}

/** 上部の店舗切替で選択中の店舗による絞込み（物件・顧客は全店舗で共有し、切替時のみ絞り込む） */
export function storeWhere(storeId: string | null): Where[] {
  return storeId ? [["storeId", "==", storeId]] : [];
}
