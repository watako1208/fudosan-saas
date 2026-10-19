"use server";
import { adminDb } from "./firebase-admin";
import { requireStaff } from "./session";
import { run, ActionResult, str } from "./action";
import { ValidationError, nowIso } from "./repo";

// 利用者別の保存済み絞込み条件。users/{uid}/savedFilters に保存する（本人のみ参照）。

export interface SavedFilter {
  id: string;
  tableId: string;
  name: string;
  query: string;
}

export async function listSavedFilters(tableId: string): Promise<SavedFilter[]> {
  const ctx = await requireStaff();
  const snap = await adminDb().collection("users").doc(ctx.uid).collection("savedFilters").where("tableId", "==", tableId).limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavedFilter, "id">) }));
}

export async function saveFilter(tableId: string, name: string, query: string): Promise<ActionResult<SavedFilter>> {
  return run(async () => {
    const ctx = await requireStaff();
    const n = str(name);
    if (!n) throw new ValidationError(["条件名を入力してください"]);
    const q = new URLSearchParams(query);
    q.delete("page");
    const r = adminDb().collection("users").doc(ctx.uid).collection("savedFilters").doc();
    const data = { tableId, name: n.slice(0, 40), query: q.toString(), createdAt: nowIso() };
    await r.set(data);
    return { id: r.id, tableId, name: data.name, query: data.query };
  });
}

export async function deleteSavedFilter(id: string): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await requireStaff();
    await adminDb().collection("users").doc(ctx.uid).collection("savedFilters").doc(id).delete();
    return null;
  });
}
