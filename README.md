# Mikke
Infrastructure Inventory &amp; Intelligence
DaDaDaと連携して、脆弱性・障害・EOL・コスト・構成変更の影響を把握する。

PLUS9.inc（ArkEve）内部専用の軽量CMDB。

- 設計: [docs/db-basic-design-v1.1.md](docs/db-basic-design-v1.1.md)
- 実装メモ（設計の補強・解釈）: [docs/implementation-notes.md](docs/implementation-notes.md)
- 次の作業・未決事項: [docs/TODO.md](docs/TODO.md)
- 開発ルール（AI Agent 向け）: [CLAUDE.md](CLAUDE.md)

## 構成

```
db/migrations/   スキーマ（素のSQL、PostgreSQL 18 必須）
apps/api/        REST API（TypeScript / Hono / node-postgres）
docs/            設計書・実装メモ
```

## 開発

### 1. 初回セットアップ

```bash
docker compose up -d          # PostgreSQL 18（mikke / mikke_test）。5432 が使用中なら下の注を参照
pnpm install
cp .env.example .env          # migrate / dev はルートの .env を読み込む
```

`.env` に最低限必要な値:

| 変数 | 内容 |
|---|---|
| `DATABASE_URL` | 例: `postgres://mikke:mikke@localhost:5432/mikke`（必須。未設定だと起動時に `DATABASE_URL is required`） |
| `PORT` | API の待受ポート（既定 8080） |
| `MIKKE_API_TOKENS` | トークンのハッシュ一覧（JSON配列）。次の手順で作る |

> 5432 や 8080 が他のプロセスで使われている場合は、`docker-compose.yml` の公開ポート、`DATABASE_URL`、`PORT` を揃えて変える。Web の開発サーバーは `/api` を `apps/web/vite.config.ts` の転送先（既定 `http://localhost:8080`）へ流すので、`PORT` を変えたらそこも合わせる。

### 2. マイグレーション

```bash
pnpm migrate
```

### 3. APIトークンの発行

```bash
pnpm --filter @mikke/api token <actor_id> mikke:read mikke:write
```

出力は2つ。**使い道が違う**ので混同しないこと。

| 出力 | 使い道 |
|---|---|
| `mikke_...` で始まる**生トークン**（一度しか表示されない） | Web UI のログイン画面、`Authorization: Bearer ...` に使う。`.env` には書かない |
| `{"actor_id":...,"token_sha256":...,"scopes":[...]}` の**JSON1行** | `.env` の `MIKKE_API_TOKENS` に配列として書く（サーバーはハッシュしか持たない） |

`.env` の例（トークンが1つの場合）:

```
MIKKE_API_TOKENS=[{"actor_id":"agent:eol-researcher","token_sha256":"<64桁の16進>","scopes":["mikke:read","mikke:write"]}]
```

複数ある場合は `[{...},{...}]` のようにカンマ区切りで並べる。`.env` を変えたら API を再起動する。

### 4. 起動・テスト

```bash
pnpm dev          # API
pnpm dev:web      # Web UI（http://localhost:5173）
```

```bash
pnpm test
```

## API（`/api/v1`、`Authorization: Bearer <token>`）

| メソッド | パス | スコープ |
|---|---|---|
| GET | `/resources`, `/resources/{id}`, `/resources/{id}/references` | read |
| POST / PATCH | `/resources`, `/resources/{id}` | write |
| POST | `/resources/{id}/archive`, `/resources/{id}/restore` | admin |
| GET / POST / DELETE | `/relations`, `/relation-types` | read / write |
| GET / POST / DELETE | `/application-repositories` | read / write |
| GET / POST / PATCH | `/deployments` | read / write |
| GET / POST / PATCH | `/software/products`, `/software/installations` | read / write |
| GET / POST / PUT | `/software/release-cycles` | read / write |
| GET / POST / PUT | `/software/lifecycle-events` | read / write（eol:approve が無い日付変更は承認待ち・202） |
| GET / POST | `/software/lifecycle-event-change-requests`, `/{id}/approve`, `/{id}/reject` | read / eol:approve |
| PUT | `/software/installations/{id}/release-cycle`, `/services/{id}/release-cycle`, `/compute/{id}/os-release-cycle` | write |
| GET | `/eol/status` | read |
| GET | `/audit-logs` | read |
