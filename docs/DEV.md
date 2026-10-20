# ローカル開発

```bash
firebase emulators:start --only auth,firestore,storage --project demo-fudosan
npm run dev
```

`.env.local`（`.env.example` をコピー）でエミュレータへ接続します。http://localhost:3000/signup から会社を登録してください。

## エミュレータ用テストアカウント（エミュレータ専用・本番では使わない）
- 会社管理者: admin@example.test / Test-Pass-2026!
