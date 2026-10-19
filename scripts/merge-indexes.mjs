// indexes/*.json の断片を firestore.indexes.json へ統合する
// 断片の形式: { "indexes": [ { "collectionGroup": "...", "fields": [["field","ASCENDING"|"DESCENDING"|"CONTAINS"], ...] } ] }
import fs from "node:fs";
import path from "node:path";
const dir = path.resolve("indexes");
const seen = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  for (const ix of j.indexes ?? []) {
    const fields = ix.fields.map(([fieldPath, mode]) =>
      mode === "CONTAINS" ? { fieldPath, arrayConfig: "CONTAINS" } : { fieldPath, order: mode },
    );
    const key = ix.collectionGroup + "|" + JSON.stringify(fields);
    seen.set(key, { collectionGroup: ix.collectionGroup, queryScope: "COLLECTION", fields });
  }
}
fs.writeFileSync("firestore.indexes.json", JSON.stringify({ indexes: [...seen.values()], fieldOverrides: [] }, null, 2) + "\n");
console.log(`firestore.indexes.json: ${seen.size} indexes`);
