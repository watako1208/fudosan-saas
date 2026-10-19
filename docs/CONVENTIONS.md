# 実装規約（モジュール共通）

仕様書: `docs/SPEC.md`（不動産業務オールインワンSaaS・実装仕様案 v1.0）。画面ID(Sxx)・業務ルールID(Bxx)・受入確認ID(Txx)はこの仕様書の番号。

## 構成
- Next.js 15 App Router + TypeScript + Tailwind v4。Firebase Auth（セッションCookie）、Firestore、Cloud Storage。App Hosting へデプロイ。
- **クライアントから Firestore/Storage へ直接アクセスしない**（ルールで全面禁止）。読み書きはサーバーコンポーネントとサーバーアクション（`"use server"`）経由のみ。
- データは `companies/{companyId}/{collection}/{id}`。コレクション名は `src/lib/types.ts` の `C`。型も同ファイル。
- 外部サービス連携（ポータル掲載、銀行、保証会社、電子署名、外部メール/LINE、外部カレンダー）は**実装しない・ボタンも出さない**。代わりに手入力・CSV・ファイル登録・結果記録。
- AI 機能は実装しない（ダミーの解析結果を返さない）。

## サーバー側（必ず守る）
- 権限: 画面は `requireStaffPage(cap)`、アクションは `requireStaff(cap)`（`src/lib/server/session.ts`）。ボタンを隠すだけにしない。重要操作（締め解除、利用者権限変更など）は `requireRecentAuth(ctx)`。
- 取得: `getDoc / mustGet / findDocs / getMany / listDocs`（`src/lib/server/repo.ts`）。これらは会社IDを強制する（T13）。
- 更新: `adminDb().runTransaction(async (tx) => { ... })` 内で `txGet → txUpdate/txCreate → audit`。**Firestore のトランザクションは「全ての読込み → 書込み」の順**（書込み後に tx.get しない）。
- 楽観的排他: 編集フォームの `_version` を `txUpdate(tx, ctx, name, cur, expectedVersion, patch)` に渡す（不一致で ConflictError → 画面が比較/再読込を表示）。
- 二重送信防止: 確定・作成系は `runOnce(ctx, requestId, async (tx) => ...)`。フォーム/ActionButton は `_requestId` を自動送信する。
- 操作記録: 変更・出力・確定は `audit(tx, ctx, action, collection, id, detail)`。
- アクションは `run(async () => {...})` で包み `ActionResult` を返す。入力エラーは `throw new ValidationError(messages, fieldErrors)`。
- 番号採番: `txNextNumber(tx, ctx, "contract", "K")`（必ずトランザクション内、読込みフェーズで）。
- 検索: 一覧対象ドキュメントに `keywords: keywords(番号, 名称, 住所...)` を保存すると `listDocs({search})` で部分一致検索できる。
- 金額は円の整数。未入力は `null`（0 や「該当なし」に置換しない）。数量・単価・率は十進文字列＋`decimal.js`。計算は `src/lib/domain/money.ts` / `rules.ts` を使う。
- 業務日付は `"YYYY-MM-DD"`、日時は ISO。表示は `formatDateTimeJst`。今日は `todayJst()`。
- 通知: トランザクション確定後に `notify(ctx, {toUid, kind, title, href, dedupeKey})`（同じ dedupeKey は重複作成しない）。
- 複合インデックス: 新しいクエリ（等価フィルタ + orderBy、array-contains + 他条件など）を書いたら `indexes/<module>.json` に追記（形式は `indexes/core.json`）。`listDocs` は常に `archived == false` + `orderBy(orderBy)` を付けるので、一覧用に `[filterField, archived, updatedAt]` 等が必要。

## 画面
- 一覧: `PageHeader`（画面名・新規）→ `FilterBar`（検索・絞込み・保存条件）→ `DataTable`（件数・一括操作・列切替・CSV・ページ切替、スマホはカード）。お手本: `src/app/(app)/properties/page.tsx`。
- 詳細: `DetailHeader`（名称・番号・状態・担当・主操作を固定）＋ `Tabs`（`?tab=`）。お手本: `src/app/(app)/properties/[id]/page.tsx`。
- 入力: `EditForm` + `FormSection` + `TextField/MoneyField/SelectField/TextArea/CheckField`。下書き保存と確定は `buttons=[{label:"下書き保存",intent:"draft"},{label:"確定",intent:"confirm",primary:true}]` で分け、サーバーで `_intent` を見て検証を変える。お手本: `properties/PropertyForm.tsx`。
- 単発操作: `ActionButton`（confirm / prompt で理由入力 / 連打防止）。
- 状態は `Badge` で**必ず文字**を表示。赤(danger)=エラー・期限超過、黄(warn)=確認待ちに限定。
- 空/0件/失敗/権限不足は `StateMessage` の kind で区別する。読込み失敗を「データなし」にしない。
- 写真・資料: `FileManager`（entity/entityId）。アップロードは `/api/upload`、閲覧は `/api/files/{id}`。
- 新規ラベル定義は `src/lib/labels.ts` の形式でモジュール内ファイルに置いてよい。

## 共有ファイルの編集
`src/lib/types.ts`, `permissions.ts`, `labels.ts`, `defaults.ts`, `src/lib/server/{repo,session,action,attachments,lookups,query,notify}.ts`, `src/components/*.tsx` は共通基盤。どうしても必要な場合のみ **Edit ツールで最小の追記**（全体の書き換え禁止）とし、報告に記載する。

## 確認
- `npx tsc --noEmit` と `npx eslint src --quiet` が通ること。業務計算は `src/lib/domain/*.test.ts` に vitest を追加（`npx vitest run`）。
