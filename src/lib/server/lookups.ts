import "server-only";
import { cache } from "react";
import { adminDb } from "./firebase-admin";
import { col } from "./repo";
import { Ctx } from "./session";
import type { ItemTypeDoc } from "@/lib/types";

/** 担当者選択用: 同じ会社の社内利用者 */
export const staffList = cache(async (companyId: string) => {
  const snap = await adminDb().collection("users").where("companyId", "==", companyId).where("kind", "==", "staff").limit(500).get();
  return snap.docs.map((d) => ({ uid: d.id, name: d.data().displayName as string, storeIds: (d.data().storeIds ?? []) as string[], disabled: !!d.data().disabled }));
});

export async function staffOptions(ctx: Ctx) {
  return (await staffList(ctx.companyId)).filter((s) => !s.disabled).map((s) => ({ value: s.uid, label: s.name }));
}

export async function staffName(ctx: Ctx, uid: string | null | undefined): Promise<string> {
  if (!uid) return "未設定";
  return (await staffList(ctx.companyId)).find((s) => s.uid === uid)?.name ?? "（不明な利用者）";
}

export async function staffNameMap(ctx: Ctx): Promise<Map<string, string>> {
  return new Map((await staffList(ctx.companyId)).map((s) => [s.uid, s.name]));
}

export const storeList = cache(async (companyId: string) => {
  const snap = await col(companyId, "stores").where("archived", "==", false).limit(200).get();
  return snap.docs.map((d) => ({ value: d.id, label: d.data().name as string }));
});

export const itemTypes = cache(async (companyId: string): Promise<ItemTypeDoc[]> => {
  const snap = await col(companyId, "itemTypes").where("archived", "==", false).limit(300).get();
  return snap.docs.map((d) => ({ ...(d.data() as ItemTypeDoc), id: d.id })).sort((a, b) => a.sort - b.sort);
});

export const companySettings = cache(async (companyId: string) => {
  const s = await adminDb().collection("companies").doc(companyId).get();
  return (s.data()?.settings ?? {}) as {
    taxRounding: "floor" | "round" | "ceil";
    lineRounding: "floor" | "round" | "ceil";
    defaultProration: { method: "actual" | "fixed30" | "none"; rounding: "floor" | "round" | "ceil" };
    fileMaxMB: number;
    fileMaxCount: number;
    closedThrough: string | null;
  };
});

export const companyName = cache(async (companyId: string) => {
  const s = await adminDb().collection("companies").doc(companyId).get();
  return (s.data()?.name as string) ?? "";
});
