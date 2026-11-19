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

```bash
docker compose up -d          # PostgreSQL 18（mikke / mikke_test）
npm install
cp .env.example .env          # 値を調整（migrate / dev / start はルートの .env を読み込む）
```

マイグレーション:

```bash
npm run migrate
```

APIトークン発行（出力のJSONを `MIKKE_API_TOKENS` の配列に追加。生トークンは一度だけ表示）:

```bash
npm run token -w @mikke/api -- agent:eol-researcher mikke:read mikke:write
```

起動・テスト:

```bash
npm run dev
```

```bash
npm test
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
