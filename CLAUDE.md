# CLAUDE.md — Mikke

PLUS9.inc（ArkEve）内部専用の軽量CMDB。インフラ資産・依存関係・デプロイ・ソフトウェアのEOLを管理する。
作業を始める前に **[docs/TODO.md](docs/TODO.md)** で次にやることを確認すること。

## 正本となるドキュメント

| ファイル | 役割 |
|---|---|
| `docs/db-basic-design-v1.1.md` | 確定済みの基本設計。**仕様の正本**。勝手に書き換えない |
| `docs/implementation-notes.md` | 設計を実装で補強・解釈した点の記録。設計と違う判断をしたら必ずここに追記する |
| `docs/TODO.md` | 次の作業と未決事項 |

設計書から読み取れないこと・判断が必要なことは、推測で進めずユーザーに質問する。

## 技術スタック

- DB: **PostgreSQL 18 必須**（`uuidv7()` を使用。16以下では動かない）
- API: TypeScript / Node.js 22 / Hono / node-postgres（ORMなし、素のSQL）/ zod
- テスト: Vitest + 実PostgreSQL（モックDBは使わない）
- フロント（未着手）: React + Vite SPA、Canvas は React Flow
- 認証: スコープ付きAPIトークン（SSOは後で差し込める構造）
- pnpm workspaces（`apps/*`、pnpm 10。`minimumReleaseAge` で公開7日未満の版は入らない）

## コマンド（リポジトリ直下で実行）

```bash
pnpm install
pnpm migrate      # ルートの .env を読む
pnpm dev
pnpm test             # mikke_test を毎回作り直す
pnpm typecheck
pnpm --filter @mikke/api token <actor_id> mikke:read mikke:write
```

コミット前に `pnpm typecheck` と `pnpm test` を必ず通す。

## 構成

```
db/migrations/          素のSQL。ファイル名順に適用、schema_migrations に履歴
apps/api/src/
  app.ts                ルーティング（/api/v1）。書き込みは全て withTx
  auth.ts config.ts     トークン認証・スコープ・設定
  services/             ドメインサービス（ここに業務ルールを書く）
  lib/                  validation（zod共通部品）, version（照合規則）, sql
apps/api/test/          統合テスト（実DB）
```

## 守るべき設計ルール

- **正本は1か所**：デプロイ=`deployments`、アプリ↔Repo=`application_repositories`、導入=`software_installations`、ホスト先=`service_instances.host_compute_id`、通信・論理依存=`resource_relations`。同じ事実を2か所に書かない
- **物理削除しない**：参照のある資産は `archived_at` でアーカイブ。関連レコードと監査履歴は残す
- **書き込みはドメインサービス経由のみ**：REST も将来の MCP も `services/*` を呼ぶ。MCP から直接SQLで更新しない
- **監査ログ**：正本の変更と `audit_logs` の記録は同一トランザクション。`actor_id` はトークンの主体
- **認証情報をDBに入れない**：`attributes` の秘密っぽいキー、`endpoint` / `repository_url` の userinfo や認証クエリは validation で拒否する
- **EOLは資産起点**：稼働中（`archived_at IS NULL AND lifecycle_status <> 'retired'`）の資産が使う系列だけ登録・監視する。共通SQLは `services/common.ts` の `EOL_TARGETS_SQL`
- **EOL日付の変更**：`mikke:eol:approve` が無い主体の日付変更は即時反映せず承認待ち（`lifecycle_event_change_requests`）。依頼者本人は決裁できない
- **不明な日付を作らない**：公式に明示されていない終了日をイベントとして登録しない

## 実装の約束事

- 入力は zod の `strictObject` で検証し、`parse()` で 422 に変換する
- エラーは `AppError(status, code, message, details)`。`code` は機械可読な snake_case
- PG の制約違反は `fromPgError` で 409/422 に変換される。DB制約で守れるものはDBでも守る（CHECK・複合FK）
- **ロック規約**（並行実行での不整合を防ぐため。崩さないこと）
  - 新しい参照先の検証は `requireResource()`（`FOR SHARE`）→ アーカイブ（`FOR UPDATE`）と直列化される
  - 更新対象の行は `requireResource(..., { lock: true })`（`FOR UPDATE`）
  - リンク削除はアプリ行を先に `FOR UPDATE`
  - 承認と再提案はどちらも「イベント行 → 依頼行」の順にロックする
- 楽観ロック：EOL系の PUT は `expected_updated_at` 必須。timestamptz はマイクロ秒まで比較するため、API は `...123456Z` 形式の文字列で返す
- マイグレーションは追加のみ。**main にマージ済みのマイグレーションは書き換えず、新しいファイルを足す**
- テストは `test/helpers.ts` の `call` / `ok` / `create` を使う。実時計に依存させない（日付は固定値か `as_of`）

## スコープ

| スコープ | 操作 |
|---|---|
| `mikke:read` | 参照 |
| `mikke:write` | 作成・更新、relation / app-repo リンクの削除 |
| `mikke:eol:approve` | EOL日付変更の承認・却下、直接の日付変更 |
| `mikke:admin` | アーカイブ・復元（全スコープを包含） |

## 開発環境の注意（Claude Code クラウドセッション）

- クラウド環境「mikke」のセットアップスクリプトが PostgreSQL 18 を入れ、`mikke` / `mikke_test` を作る
- コンテナ再起動後に PG が止まっていることがある。`ECONNREFUSED` が出たら `pg_ctlcluster 18 main start`
- `pg_lsclusters` で 16 も online に見えることがあるが、古い pid ファイルの表示。5432 で応答しているのは 18
- ローカルでは `docker compose up -d`（postgres:18、localhost のみ公開）

## PR とレビュー

- PR には Codex と CodeRabbit が自動レビューを付ける。指摘はコードで確認してから対応し、スレッドに返信する
- **セキュリティ関連の指摘は、修正してもスレッドを自分で resolve しない**（ユーザーが判断する）
- マージはユーザーが行う
