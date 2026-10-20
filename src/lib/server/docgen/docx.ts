import "server-only";
// 編集可能な Word（DOCX）出力。見出し・段落は実際のテキスト、表は Word の表（見出し行をページごとに繰り返し）、
// 改ページ・画像（JPEG/PNG）も Word の要素として出力する。日本語フォントは游ゴシックを指定。
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import type { DocBlock } from "@/lib/types";

export interface LoadedImage {
  data: Buffer;
  type: "png" | "jpg";
  width: number;
  height: number;
}

const FONT = { ascii: "Yu Gothic", hAnsi: "Yu Gothic", eastAsia: "游ゴシック", cs: "Yu Gothic" };
const NUMERIC = /^[-−]?[¥￥]?[\d,]+(\.\d+)?(円|%|％|㎡|か月|本|日)?$/;
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "444444" };
/** A4 縦・余白 15mm の本文幅（px, 96dpi） */
const CONTENT_WIDTH_PX = 680;

function runs(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun[] {
  const lines = (text ?? "").split(/\r?\n/);
  return lines.map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined, bold: opts.bold, size: opts.size, font: FONT }));
}

/** 画像の縦横（PNG / JPEG のヘッダーから取得） */
export function imageInfo(buf: Buffer): { type: "png" | "jpg"; width: number; height: number } | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { type: "jpg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export async function renderDocx(
  blocks: DocBlock[],
  opts: { title: string; loadImage: (attachmentId: string) => Promise<LoadedImage | null | "unsupported"> },
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        const level = b.level === 1 ? HeadingLevel.HEADING_1 : b.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        children.push(new Paragraph({ heading: level, alignment: b.level === 1 ? AlignmentType.CENTER : undefined, keepNext: true, children: runs(b.text, { bold: true }) }));
        break;
      }
      case "paragraph":
        children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.text) }));
        break;
      case "table": {
        const header = new TableRow({
          tableHeader: true, // ページをまたぐとき見出し行を繰り返す
          cantSplit: true,
          children: b.columns.map((c) => new TableCell({ shading: { type: ShadingType.CLEAR, color: "auto", fill: "EEEEEE" }, borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }, children: [new Paragraph({ children: runs(c, { bold: true, size: 19 }) })] })),
        });
        const body = b.rows.map(
          (r) =>
            new TableRow({
              cantSplit: true,
              children: b.columns.map((_, ci) => {
                const v = r[ci] ?? "";
                return new TableCell({
                  borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
                  children: [new Paragraph({ alignment: NUMERIC.test(v.trim()) ? AlignmentType.RIGHT : AlignmentType.LEFT, children: runs(v, { size: 19 }) })],
                });
              }),
            }),
        );
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] }));
        children.push(new Paragraph({ children: [] }));
        break;
      }
      case "image": {
        const img = await opts.loadImage(b.attachmentId);
        if (img && img !== "unsupported") {
          const maxW = Math.round((CONTENT_WIDTH_PX * (b.widthPct ?? 60)) / 100);
          const w = Math.min(maxW, img.width || maxW);
          const h = img.width ? Math.round((img.height / img.width) * w) : Math.round(w * 0.75);
          children.push(new Paragraph({ keepNext: !!b.caption, children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: w, height: h }, altText: { name: b.caption || "画像", description: b.caption || "画像", title: b.caption || "画像" } })] }));
        } else {
          children.push(new Paragraph({ children: runs(img === "unsupported" ? "［画像: Word出力に対応していない形式（WebP）のため省略しました。印刷・PDFでは表示されます］" : "［画像: 閲覧権限がないか見つからないため省略しました］", { size: 18 }) }));
        }
        if (b.caption) children.push(new Paragraph({ spacing: { after: 120 }, children: runs(b.caption, { size: 18 }) }));
        break;
      }
      case "pagebreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case "spacer":
        children.push(new Paragraph({ spacing: { before: Math.round(b.height * 15) }, children: [] }));
        break;
    }
  }
  const doc = new Document({
    title: opts.title,
    creator: "不動産業務クラウド",
    styles: {
      default: {
        document: { run: { font: FONT, size: 21 } },
        heading1: { run: { font: FONT, size: 34, bold: true, color: "111111" }, paragraph: { spacing: { after: 240 } } },
        heading2: { run: { font: FONT, size: 26, bold: true, color: "111111" }, paragraph: { spacing: { before: 240, after: 120 } } },
        heading3: { run: { font: FONT, size: 22, bold: true, color: "111111" }, paragraph: { spacing: { before: 160, after: 80 } } },
      },
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 907, bottom: 1020, left: 850, right: 850 } } },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
