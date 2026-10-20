import Link from "next/link";
import { requireStaffPage } from "@/lib/server/session";
import { adminAuth, adminDb } from "@/lib/server/firebase-admin";
import { col } from "@/lib/server/repo";
import { tabOf, SP } from "@/lib/server/query";
import { staffNameMap } from "@/lib/server/lookups";
import {
  updateCompanySettings, updateAttachmentCategories, createStore, updateStore, archiveStore, updateUserAccess,
  createItemType, reviseItemType, revokeInvite,
} from "@/lib/server/actions/settings";
import { C, Store, ItemTypeDoc } from "@/lib/types";
import { ROLE_LABEL, EXTERNAL_LABEL, GRANTABLE_CAPS, StaffRole, ExternalKind } from "@/lib/permissions";
import { PageHeader, Tabs, Card, Badge, StateMessage } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { MiniForm } from "@/components/support/MiniForm";
import { StaffInviteForm, ExternalInviteForm } from "./InviteForms";
import { DEFAULT_ATTACHMENT_CATEGORIES, INVITE_STATE, CAP_LABEL, inviteState, lbl, tone } from "@/lib/labels-support";
import { TAX_CATEGORY_LABEL, PRORATION_LABEL } from "@/lib/defaults";
import { formatDateTimeJst, todayJst, isValidBizDate, addDays } from "@/lib/domain/dates";

export const metadata = { title: "設定" };

const TABS = ["company", "stores", "users", "external", "items", "categories", "audit", "security"];
const ROUNDING = { floor: "切捨て", round: "四捨五入", ceil: "切上げ" } as const;

function Sel({ name, value, options }: { name: string; value: string; options: Record<string, string> }) {
  return (
    <select name={name} defaultValue={value} className="input">
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}

/** S25 設定・データ管理（会社管理者のみ） */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireStaffPage("settings.manage");
  const sp = await searchParams;
  const tab = tabOf(sp, TABS, "company");
  return (
    <>
      <PageHeader
        title="設定・データ管理"
        sub="会社管理者だけが変更できます。設定の変更は適用開始日以降に有効となり、過去の確定計算・確定済みデータは変わりません。"
        actions={
          <>
            <Link href="/billing/close" className="btn btn-secondary">月次締め</Link>
            <Link href="/billing/jobs" className="btn btn-secondary">定期処理の履歴</Link>
            <Link href="/documents?tab=templates" className="btn btn-secondary">書式（テンプレート）</Link>
          </>
        }
      />
      <Tabs
        base="/settings"
        current={tab}
        tabs={[
          { key: "company", label: "会社・計算方法" },
          { key: "stores", label: "店舗" },
          { key: "users", label: "利用者・権限" },
          { key: "external", label: "外部利用者" },
          { key: "items", label: "費目" },
          { key: "categories", label: "分類" },
          { key: "audit", label: "操作記録" },
          { key: "security", label: "多要素認証" },
        ]}
      />
      {tab === "company" && <CompanyTab companyId={ctx.companyId} />}
      {tab === "stores" && <StoresTab companyId={ctx.companyId} />}
      {tab === "users" && <UsersTab companyId={ctx.companyId} selfUid={ctx.uid} />}
      {tab === "external" && <ExternalTab companyId={ctx.companyId} />}
      {tab === "items" && <ItemsTab companyId={ctx.companyId} />}
      {tab === "categories" && <CategoriesTab companyId={ctx.companyId} />}
      {tab === "audit" && (ctx.caps.has("audit.read") ? <AuditTab ctx={ctx} sp={sp} /> : <div className="card"><StateMessage kind="forbidden" /></div>)}
      {tab === "security" && <SecurityTab companyId={ctx.companyId} />}
    </>
  );
}

async function CompanyTab({ companyId }: { companyId: string }) {
  const snap = await adminDb().collection("companies").doc(companyId).get();
  const c = snap.data() ?? {};
  const s = (c.settings ?? {}) as Record<string, unknown> & { defaultProration?: { method: string; rounding: string } };
  const hist = await col(companyId, "settingsHistory").orderBy("at", "desc").limit(20).get();
  return (
    <div className="space-y-4">
      <Card title="会社・計算方法">
        <MiniForm action={updateCompanySettings} submitLabel="保存（適用開始日から有効）" resetOnSuccess={false} confirm="設定を変更します。適用開始日より前の確定済みデータは再計算しません。よろしいですか？">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block"><span className="label">会社名</span><input name="name" defaultValue={String(c.name ?? "")} className="input" /></label>
            <label className="block"><span className="label">消費税の端数処理（税率別に集計後）</span><Sel name="taxRounding" value={String(s.taxRounding ?? "floor")} options={ROUNDING} /></label>
            <label className="block"><span className="label">明細金額（数量×単価）の端数処理</span><Sel name="lineRounding" value={String(s.lineRounding ?? "floor")} options={ROUNDING} /></label>
            <label className="block"><span className="label">日割りの初期方式</span><Sel name="prorationMethod" value={s.defaultProration?.method ?? "actual"} options={PRORATION_LABEL} /></label>
            <label className="block"><span className="label">日割りの端数処理</span><Sel name="prorationRounding" value={s.defaultProration?.rounding ?? "floor"} options={ROUNDING} /></label>
            <label className="block"><span className="label">1ファイルの上限（MB、1〜30）</span><input name="fileMaxMB" inputMode="numeric" defaultValue={String(s.fileMaxMB ?? 30)} className="input" /></label>
            <label className="block"><span className="label">1回に登録できる件数（1〜50）</span><input name="fileMaxCount" inputMode="numeric" defaultValue={String(s.fileMaxCount ?? 50)} className="input" /></label>
            <label className="block"><span className="label">適用開始日</span><input name="effectiveFrom" type="date" defaultValue={todayJst()} min={todayJst()} className="input" /></label>
          </div>
          <p className="help">
            契約版・請求・精算は作成時の計算設定を保存しているため、ここで変更しても確定済みの計算は変わりません。将来日を指定した場合は定期処理で適用開始日に反映します。
            重要な操作のため、直近にログインしていない場合は再認証を求めます。
          </p>
        </MiniForm>
      </Card>
      <Card title="変更履歴">
        {hist.empty ? (
          <StateMessage kind="empty" message="変更履歴はありません" />
        ) : (
          <table className="table">
            <thead><tr><th>登録日時</th><th>適用開始日</th><th>状態</th><th>内容</th><th>変更者</th></tr></thead>
            <tbody>
              {hist.docs.map((d) => {
                const h = d.data();
                const v = h.settings ?? {};
                return (
                  <tr key={d.id}>
                    <td>{formatDateTimeJst(h.at)}</td>
                    <td>{h.effectiveFrom}</td>
                    <td><Badge tone={h.status === "applied" ? "ok" : "warn"}>{h.status === "applied" ? "適用済み" : "適用待ち"}</Badge></td>
                    <td className="text-sm">税 {ROUNDING[v.taxRounding as keyof typeof ROUNDING] ?? "—"} ／ 明細 {ROUNDING[v.lineRounding as keyof typeof ROUNDING] ?? "—"} ／ 日割り {PRORATION_LABEL[v.defaultProration?.method as keyof typeof PRORATION_LABEL] ?? "—"} ／ {v.fileMaxMB}MB・{v.fileMaxCount}件</td>
                    <td>{h.byName ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

async function StoresTab({ companyId }: { companyId: string }) {
  const snap = await col(companyId, C.stores).limit(200).get();
  const stores = snap.docs.map((d) => ({ ...(d.data() as Store), id: d.id })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <div className="space-y-4">
      <Card title="店舗を追加">
        <MiniForm action={createStore} submitLabel="追加">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block"><span className="label">店舗名</span><input name="name" className="input" /></label>
            <label className="block"><span className="label">所在地</span><input name="address" className="input" /></label>
            <label className="block"><span className="label">電話番号</span><input name="phone" className="input" /></label>
          </div>
        </MiniForm>
      </Card>
      {stores.map((s) => (
        <Card
          key={s.id}
          title={<span className="inline-flex items-center gap-2">{s.name}{s.archived && <Badge>アーカイブ</Badge>}</span>}
          actions={<ActionButton action={archiveStore} args={{ id: s.id }} label={s.archived ? "アーカイブ解除" : "アーカイブ"} size="sm" confirm={s.archived ? "アーカイブを解除しますか？" : "この店舗をアーカイブしますか？（データは削除されません）"} />}
        >
          <MiniForm action={updateStore.bind(null, s.id)} args={{ _version: s.version }} submitLabel="保存" resetOnSuccess={false}>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block"><span className="label">店舗名</span><input name="name" defaultValue={s.name} className="input" /></label>
              <label className="block"><span className="label">所在地</span><input name="address" defaultValue={s.address ?? ""} className="input" /></label>
              <label className="block"><span className="label">電話番号</span><input name="phone" defaultValue={s.phone ?? ""} className="input" /></label>
            </div>
          </MiniForm>
        </Card>
      ))}
    </div>
  );
}

interface UserRow { uid: string; displayName: string; email: string; kind: string; roles: StaffRole[]; extraCaps: string[]; storeIds: string[]; partyId?: string | null; disabled?: boolean }

async function loadUsers(companyId: string): Promise<UserRow[]> {
  const snap = await adminDb().collection("users").where("companyId", "==", companyId).limit(1000).get();
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserRow, "uid">) })).sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
}

async function loadInvites(companyId: string) {
  const snap = await adminDb().collection("inviteCodes").where("companyId", "==", companyId).orderBy("createdAt", "desc").limit(100).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as { kind: string; label: string; roles: string[]; expiresAt: string; createdAt: string; usedBy: string | null; usedAt?: string; revoked: boolean; partyId: string | null }) }));
}

function InviteTable({ invites, names }: { invites: Awaited<ReturnType<typeof loadInvites>>; names: Map<string, string> }) {
  const now = new Date().toISOString();
  if (!invites.length) return <StateMessage kind="empty" message="発行した招待コードはありません" />;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>発行日時</th><th>種別</th><th>メモ</th><th>有効期限</th><th>状態</th><th></th></tr></thead>
        <tbody>
          {invites.map((i) => {
            const st = inviteState(i, now);
            return (
              <tr key={i.id}>
                <td>{formatDateTimeJst(i.createdAt)}</td>
                <td>{i.kind === "staff" ? `社内（${(i.roles ?? []).map((r) => ROLE_LABEL[r as StaffRole] ?? r).join("・")}）` : EXTERNAL_LABEL[i.kind as ExternalKind] ?? i.kind}</td>
                <td className="break-words">{i.label}</td>
                <td>{formatDateTimeJst(i.expiresAt)}</td>
                <td>
                  <Badge tone={tone(INVITE_STATE, st)}>{lbl(INVITE_STATE, st)}</Badge>
                  {st === "used" && i.usedBy && <span className="ml-1 text-xs text-muted">{names.get(i.usedBy) ?? ""}</span>}
                </td>
                <td>{st === "active" && <ActionButton action={revokeInvite} args={{ id: i.id }} label="無効化" size="sm" variant="danger" confirm="この招待コードを無効化しますか？" />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function UsersTab({ companyId, selfUid }: { companyId: string; selfUid: string }) {
  const [users, invites, storesSnap] = await Promise.all([
    loadUsers(companyId),
    loadInvites(companyId),
    col(companyId, C.stores).where("archived", "==", false).limit(200).get(),
  ]);
  const stores = storesSnap.docs.map((d) => ({ value: d.id, label: d.data().name as string }));
  const staff = users.filter((u) => u.kind === "staff");
  const names = new Map(users.map((u) => [u.uid, u.displayName]));
  return (
    <div className="space-y-4">
      <Card title="社内利用者">
        <p className="help mb-3">権限・所属店舗の変更と利用停止は重要操作のため、直近にログインしていない場合は再認証を求めます。利用停止すると既存のログインも無効になります。</p>
        <div className="space-y-2">
          {staff.map((u) => (
            <details key={u.uid} className="rounded-md border border-line">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-semibold">{u.displayName}</span>
                <span className="text-sm text-muted">{u.email}</span>
                {(u.roles ?? []).map((r) => <Badge key={r}>{ROLE_LABEL[r] ?? r}</Badge>)}
                {u.disabled && <Badge tone="danger">利用停止</Badge>}
                {u.uid === selfUid && <Badge tone="info">自分</Badge>}
              </summary>
              <div className="p-3">
                <MiniForm action={updateUserAccess} args={{ uid: u.uid }} submitLabel="変更を保存" resetOnSuccess={false} confirm={`${u.displayName} さんの権限を変更しますか？`}>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <fieldset>
                      <legend className="label">権限</legend>
                      {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => (
                        <label key={r} className="flex min-h-8 items-center gap-2 text-sm">
                          <input type="checkbox" name="roles" value={r} data-multi="1" defaultChecked={(u.roles ?? []).includes(r)} /> {ROLE_LABEL[r]}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset>
                      <legend className="label">追加付与</legend>
                      {GRANTABLE_CAPS.map((c) => (
                        <label key={c} className="flex min-h-8 items-center gap-2 text-sm">
                          <input type="checkbox" name="extraCaps" value={c} data-multi="1" defaultChecked={(u.extraCaps ?? []).includes(c)} /> {CAP_LABEL[c] ?? c}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset>
                      <legend className="label">所属店舗</legend>
                      {stores.map((s) => (
                        <label key={s.value} className="flex min-h-8 items-center gap-2 text-sm">
                          <input type="checkbox" name="storeIds" value={s.value} data-multi="1" defaultChecked={(u.storeIds ?? []).includes(s.value)} /> {s.label}
                        </label>
                      ))}
                      <label className="mt-3 flex min-h-8 items-center gap-2 text-sm text-danger">
                        <input type="checkbox" name="disabled" defaultChecked={!!u.disabled} disabled={u.uid === selfUid} /> 利用停止
                      </label>
                    </fieldset>
                  </div>
                </MiniForm>
              </div>
            </details>
          ))}
        </div>
      </Card>
      <Card title="社内利用者を招待">
        <StaffInviteForm stores={stores} />
      </Card>
      <Card title="招待コード（社内・外部）">
        <InviteTable invites={invites} names={names} />
      </Card>
    </div>
  );
}

async function ExternalTab({ companyId }: { companyId: string }) {
  const users = (await loadUsers(companyId)).filter((u) => u.kind !== "staff");
  const invites = (await loadInvites(companyId)).filter((i) => i.kind !== "staff");
  const pids = [...new Set(users.map((u) => u.partyId).filter((x): x is string => !!x && !x.includes("/")))].slice(0, 300);
  const parties = pids.length ? await adminDb().getAll(...pids.map((id) => col(companyId, C.parties).doc(id))) : [];
  const partyName = new Map(parties.filter((d) => d.exists && d.data()!.companyId === companyId).map((d) => [d.id, d.data()!.name as string]));
  return (
    <div className="space-y-4">
      <Card title="外部利用者を招待">
        <ExternalInviteForm />
      </Card>
      <Card title="外部利用者">
        {users.length === 0 ? (
          <StateMessage kind="empty" message="外部利用者はまだいません" />
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.uid} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
                <span className="font-semibold">{u.displayName}</span>
                <Badge>{EXTERNAL_LABEL[u.kind as ExternalKind] ?? u.kind}</Badge>
                <span className="text-sm text-muted">関係者: {u.partyId ? partyName.get(u.partyId) ?? u.partyId : "未設定"}</span>
                {u.disabled && <Badge tone="danger">利用停止</Badge>}
                <span className="ml-auto">
                  <MiniForm action={updateUserAccess} args={{ uid: u.uid, disabled: !u.disabled }} submitLabel={u.disabled ? "利用を再開" : "利用停止"} resetOnSuccess={false} confirm={u.disabled ? "利用を再開しますか？" : "この外部利用者を利用停止にしますか？"}>
                    <span />
                  </MiniForm>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="外部利用者の招待コード">
        <InviteTable invites={invites} names={new Map(users.map((u) => [u.uid, u.displayName]))} />
      </Card>
    </div>
  );
}

function ItemCalcFields({ it }: { it?: ItemTypeDoc }) {
  return (
    <>
      <label className="block"><span className="label">税区分</span><Sel name="taxCategory" value={it?.tax.category ?? "taxable"} options={TAX_CATEGORY_LABEL} /></label>
      <label className="block"><span className="label">税率（課税のみ）</span><input name="taxRate" defaultValue={it?.tax.category === "taxable" ? it.tax.rate : "0.10"} className="input" /></label>
      <label className="block"><span className="label">金額の扱い</span><Sel name="priceMode" value={it?.tax.priceMode ?? "exclusive"} options={{ exclusive: "税抜", inclusive: "税込" }} /></label>
      <label className="block"><span className="label">日割り方式</span><Sel name="prorationMethod" value={it?.proration.method ?? "none"} options={PRORATION_LABEL} /></label>
      <label className="block"><span className="label">日割りの端数</span><Sel name="prorationRounding" value={it?.proration.rounding ?? "floor"} options={ROUNDING} /></label>
      <label className="block"><span className="label">適用開始日</span><input name="effectiveFrom" type="date" defaultValue={todayJst()} min={todayJst()} className="input" /></label>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="managementFeeTarget" defaultChecked={!!it?.managementFeeTarget} /> 管理料の算定対象</label>
    </>
  );
}

async function ItemsTab({ companyId }: { companyId: string }) {
  const [itSnap, verSnap] = await Promise.all([
    col(companyId, C.itemTypes).limit(300).get(),
    col(companyId, "itemTypeVersions").orderBy("at", "desc").limit(50).get(),
  ]);
  const items = itSnap.docs.map((d) => ({ ...(d.data() as ItemTypeDoc & { scheduledChange?: { effectiveFrom: string } | null }), id: d.id })).sort((a, b) => a.sort - b.sort);
  const kindLabel = { monthly: "月額", initial: "初期費用", one_time: "一時", deposit: "預り金" } as const;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        費目の税区分・日割り設定を変更すると、旧設定は版として保存されます。契約版・請求は作成時の設定を保存しているため、過去の計算は変わりません（B10/S25）。
      </p>
      <Card title="費目一覧">
        <div className="space-y-2">
          {items.map((it) => (
            <details key={it.id} className="rounded-md border border-line">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-semibold">{it.name}</span>
                <span className="text-xs text-muted">{it.code}</span>
                <Badge>{kindLabel[it.kind]}</Badge>
                <span className="text-sm">
                  {TAX_CATEGORY_LABEL[it.tax.category]}{it.tax.category === "taxable" ? ` ${Math.round(Number(it.tax.rate) * 100)}%（${it.tax.priceMode === "inclusive" ? "税込" : "税抜"}）` : ""} ／ 日割り: {PRORATION_LABEL[it.proration.method]}
                </span>
                <span className="text-xs text-muted">適用開始 {it.effectiveFrom}</span>
                {it.scheduledChange && <Badge tone="warn">変更予約 {it.scheduledChange.effectiveFrom}</Badge>}
              </summary>
              <div className="p-3">
                <MiniForm action={reviseItemType} args={{ code: it.id, _version: it.version }} submitLabel="新しい設定を保存" resetOnSuccess={false}>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block"><span className="label">費目名</span><input name="name" defaultValue={it.name} className="input" /></label>
                    <ItemCalcFields it={it} />
                    <label className="block sm:col-span-2 lg:col-span-4"><span className="label">変更理由<span className="ml-1 text-xs text-danger">必須</span></span><input name="reason" className="input" /></label>
                  </div>
                </MiniForm>
              </div>
            </details>
          ))}
        </div>
      </Card>
      <Card title="費目を追加">
        <MiniForm action={createItemType} submitLabel="追加">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className="label">コード（英小文字）</span><input name="code" className="input" placeholder="例: bicycle_parking" /></label>
            <label className="block"><span className="label">費目名</span><input name="name" className="input" /></label>
            <label className="block"><span className="label">種類</span><Sel name="kind" value="monthly" options={kindLabel} /></label>
            <label className="block"><span className="label">表示順</span><input name="sort" inputMode="numeric" defaultValue="500" className="input" /></label>
            <ItemCalcFields />
          </div>
        </MiniForm>
      </Card>
      <Card title="費目の変更履歴（版）">
        {verSnap.empty ? (
          <StateMessage kind="empty" message="変更履歴はありません" />
        ) : (
          <table className="table">
            <thead><tr><th>登録日時</th><th>費目</th><th>適用開始日</th><th>状態</th><th>変更前</th><th>理由</th><th>変更者</th></tr></thead>
            <tbody>
              {verSnap.docs.map((d) => {
                const v = d.data();
                const before = v.snapshot ?? {};
                return (
                  <tr key={d.id}>
                    <td>{formatDateTimeJst(v.at)}</td>
                    <td>{v.next?.name ?? v.code}</td>
                    <td>{v.effectiveFrom}</td>
                    <td><Badge tone={v.status === "applied" ? "ok" : "warn"}>{v.status === "applied" ? "適用済み" : "適用待ち"}</Badge></td>
                    <td className="text-sm">{TAX_CATEGORY_LABEL[before.tax?.category as keyof typeof TAX_CATEGORY_LABEL] ?? "—"} ／ {PRORATION_LABEL[before.proration?.method as keyof typeof PRORATION_LABEL] ?? "—"}</td>
                    <td className="break-words">{v.reason}</td>
                    <td>{v.byName ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

async function CategoriesTab({ companyId }: { companyId: string }) {
  const c = (await adminDb().collection("companies").doc(companyId).get()).data();
  const list = (c?.settings?.attachmentCategories as string[] | undefined) ?? DEFAULT_ATTACHMENT_CATEGORIES;
  return (
    <Card title="写真・資料の分類">
      <MiniForm action={updateAttachmentCategories} submitLabel="保存" resetOnSuccess={false}>
        <label className="block">
          <span className="label">分類（1行に1つ）</span>
          <textarea name="categories" rows={14} defaultValue={list.join("\n")} className="input font-mono" />
        </label>
        <p className="help">分類名の変更は、登録済みのファイルの分類を書き換えません。</p>
      </MiniForm>
    </Card>
  );
}

async function AuditTab({ ctx, sp }: { ctx: Awaited<ReturnType<typeof requireStaffPage>>; sp: SP }) {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const entity = g("entity");
  const uid = g("uid");
  const from = isValidBizDate(g("from")) ? g("from") : addDays(todayJst(), -30);
  const to = isValidBizDate(g("to")) ? g("to") : todayJst();
  const names = await staffNameMap(ctx);
  let rows: { id: string; at: string; uid: string; userName: string; action: string; entity: string; entityId: string; detail: unknown }[] = [];
  let error = false;
  try {
    let q = col(ctx.companyId, C.auditLogs) as FirebaseFirestore.Query;
    if (entity) q = q.where("entity", "==", entity);
    if (uid) q = q.where("uid", "==", uid);
    q = q
      .where("at", ">=", new Date(`${from}T00:00:00+09:00`).toISOString())
      .where("at", "<", new Date(`${addDays(to, 1)}T00:00:00+09:00`).toISOString())
      .orderBy("at", "desc")
      .limit(200);
    rows = (await q.get()).docs.map((d) => ({ ...(d.data() as (typeof rows)[number]), id: d.id }));
  } catch (e) {
    console.error("[audit.list]", (e as Error).message);
    error = true;
  }
  return (
    <Card title="操作記録（閲覧のみ・変更や削除はできません）">
      <form action="/settings" className="mb-3 grid gap-3 sm:grid-cols-5">
        <input type="hidden" name="tab" value="audit" />
        <label className="block"><span className="label">対象（コレクション名）</span><input name="entity" defaultValue={entity} className="input" placeholder="例: contracts" /></label>
        <label className="block">
          <span className="label">利用者</span>
          <select name="uid" defaultValue={uid} className="input">
            <option value="">すべて</option>
            {[...names].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">開始日</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label className="block"><span className="label">終了日</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <div className="flex items-end"><button className="btn btn-primary w-full">絞り込む</button></div>
      </form>
      {error ? (
        <StateMessage kind="error" message="操作記録を読み込めませんでした" />
      ) : rows.length === 0 ? (
        <StateMessage kind="no_results" message="条件に一致する操作記録はありません" />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>日時</th><th>利用者</th><th>操作</th><th>対象</th><th>内容</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatDateTimeJst(r.at)}</td>
                  <td>{r.userName ?? names.get(r.uid) ?? r.uid}</td>
                  <td>{r.action}</td>
                  <td className="break-all text-sm">{r.entity} / {r.entityId}</td>
                  <td>
                    <details>
                      <summary className="cursor-pointer text-sm text-primary">表示</summary>
                      <pre className="mt-1 max-w-xl overflow-x-auto text-xs whitespace-pre-wrap">{JSON.stringify(r.detail, null, 1)?.slice(0, 3000)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="help mt-2">最新200件まで表示します。期間を絞り込んでください。</p>
        </div>
      )}
    </Card>
  );
}

async function SecurityTab({ companyId }: { companyId: string }) {
  const admins = (await loadUsers(companyId)).filter((u) => u.kind === "staff" && (u.roles ?? []).includes("admin"));
  const status = await Promise.all(
    admins.map(async (u) => {
      try {
        const rec = await adminAuth().getUser(u.uid);
        return { u, n: rec.multiFactor?.enrolledFactors?.length ?? 0, ok: true };
      } catch {
        return { u, n: 0, ok: false };
      }
    }),
  );
  return (
    <div className="space-y-4">
      <Card title="会社管理者の多要素認証">
        <table className="table">
          <thead><tr><th>管理者</th><th>多要素認証</th></tr></thead>
          <tbody>
            {status.map((s) => (
              <tr key={s.u.uid}>
                <td>{s.u.displayName}</td>
                <td>
                  {!s.ok ? <Badge tone="danger">確認できません</Badge> : s.n > 0 ? <Badge tone="ok">登録済み（{s.n}件）</Badge> : <Badge tone="warn">未登録</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="多要素認証の設定（必須の運用設定）">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Firebase コンソールで Authentication を Identity Platform にアップグレードし、多要素認証（TOTP 認証アプリ）を有効にします。</li>
          <li>ログイン画面が多要素認証の確認（第2要素の入力）に対応していることを確認します。対応前に登録するとログインできなくなるため、この画面からの登録操作は提供していません。</li>
          <li>各管理者が認証アプリ（Google Authenticator など）を登録します。登録状況は上の表で確認できます。</li>
        </ol>
        <p className="help mt-2">パスワードは Firebase Authentication が管理し、このシステムでは保存しません。権限変更などの重要操作では直近の再ログインを求めます。</p>
      </Card>
    </div>
  );
}
