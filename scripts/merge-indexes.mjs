// indexes/*.json の断片を firestore.indexes.json へ統合する（上限200件に収めるため整理する）
// 断片の形式: { "indexes": [ { "collectionGroup": "...", "fields": [["field","ASCENDING"|"DESCENDING"|"CONTAINS"], ...] } ] }
// 一覧(listDocs)の複合条件・非既定の並べ替えは、インデックスが無い場合サーバー側で並べ替える代替処理があるため登録しない。
import fs from "node:fs";
import path from "node:path";
const DEFAULT_SORTS = new Set(["updatedAt", "receivedAt", "start", "date", "dueDate", "createdAt", "startedAt", "requestedAt", "at"]);
const dir = path.resolve("indexes");
const seen = new Map();
let dropped = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const ix of j.indexes ?? []) {
    const names = ix.fields.map(([n]) => n);
    const ai = names.indexOf("archived");
    if (ai >= 0 && ai === names.length - 2) {
      const sort = names[names.length - 1];
      if (ai >= 2 || (ai === 1 && !DEFAULT_SORTS.has(sort))) { dropped++; continue; }
    }
    // 等価条件+並べ替え1項目のインデックスは逆順にも使えるため、向き違いは1つにまとめる
    const key = ix.collectionGroup + "|" + ix.fields.map(([n, m]) => n + (m === "CONTAINS" ? ":C" : "")).join(",");
    if (seen.has(key)) continue;
    const fields = ix.fields.map(([fieldPath, mode]) =>
      mode === "CONTAINS" ? { fieldPath, arrayConfig: "CONTAINS" } : { fieldPath, order: mode },
    );
    seen.set(key, { collectionGroup: ix.collectionGroup, queryScope: "COLLECTION", fields });
  }
}
fs.writeFileSync("firestore.indexes.json", JSON.stringify({ indexes: [...seen.values()], fieldOverrides: [] }, null, 2) + "\n");
console.log(`firestore.indexes.json: ${seen.size} indexes (${dropped} list-combination indexes left to fallback)`);
if (seen.size > 200) { console.error("200件の上限を超えています"); process.exit(1); }
