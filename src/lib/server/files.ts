import "server-only";

// ファイル検証: 拡張子だけでなく先頭バイトで実際の種類を判定する。
// 実行形式・マクロ付きファイルは受け付けない。

export type Sniffed = { type: string; ext: string } | null;

const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png", "webp", "docx", "xlsx", "csv"];

export function sniff(buf: Uint8Array, fileName: string): Sniffed {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const b = (i: number) => buf[i];
  const startsWith = (sig: number[]) => sig.every((v, i) => b(i) === v);
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { type: "application/pdf", ext: "pdf" };
  if (startsWith([0xff, 0xd8, 0xff])) return { type: "image/jpeg", ext: "jpg" };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image/png", ext: "png" };
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && buf.length > 12 && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return { type: "image/webp", ext: "webp" };
  if (startsWith([0x50, 0x4b, 0x03, 0x04])) {
    // ZIP: OOXML。中身にマクロ(vbaProject.bin)を含むものは拒否
    const text = Buffer.from(buf).toString("latin1");
    if (/vbaProject\.bin/i.test(text)) return null;
    if (ext === "docx" && text.includes("word/")) return { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" };
    if (ext === "xlsx" && text.includes("xl/")) return { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" };
    return null;
  }
  if (startsWith([0x4d, 0x5a]) || startsWith([0x7f, 0x45, 0x4c, 0x46]) || startsWith([0xd0, 0xcf, 0x11, 0xe0])) return null; // EXE / ELF / 旧Office(マクロ可)
  if (ext === "csv") {
    // テキストであること（NULバイトを含まない）
    if (buf.slice(0, 4096).includes(0)) return null;
    return { type: "text/csv", ext: "csv" };
  }
  return null;
}

export function isAllowedName(fileName: string) {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  return ALLOWED_EXT.includes(ext);
}

export function isImage(type: string) {
  return type.startsWith("image/");
}
