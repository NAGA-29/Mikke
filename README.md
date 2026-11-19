# Mikke
Infrastructure Inventory &amp; Intelligence
DaDaDaと連携して、脆弱性・障害・EOL・コスト・構成変更の影響を把握する。

PLUS9.inc（ArkEve）内部専用の軽量CMDB。

- 設計: [docs/db-basic-design-v1.1.md](docs/db-basic-design-v1.1.md)
- 実装メモ（設計の補強・解釈）: [docs/implementation-notes.md](docs/implementation-notes.md)

## 構成

```
db/migrations/   PostgreSQL 18 向けスキーマ（素のSQL）
apps/api/        REST API（TypeScript / Hono / node-postgres）
docs/            設計書・実装メモ
```

## 開発

```bash
docker compose up -d          # PostgreSQL 18（mikke / mikke_test）
npm install
cp .env.example .env          # 値を調整
```

マイグレーション:

```bash
DATABASE_URL=postgres://mikke:mikke@localhost:5432/mikke npm run migrate
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
| GET / POST / PUT | `/software/lifecycle-events` | read / write（日付変更は eol:approve） |
| PUT | `/software/installations/{id}/release-cycle`, `/services/{id}/release-cycle`, `/compute/{id}/os-release-cycle` | write |
| GET | `/eol/status` | read |
| GET | `/audit-logs` | read |
