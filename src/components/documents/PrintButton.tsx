"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      印刷 / PDFとして保存
    </button>
  );
}
