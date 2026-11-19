# Mikke 実装メモ（DB基本設計 v1.1 → Step 1 実装）

正本の設計は [db-basic-design-v1.1.md](./db-basic-design-v1.1.md)。ここには実装時に設計書を補強・解釈した点を記録する。

## 技術スタック

| 層 | 採用 |
|---|---|
| DB | **PostgreSQL 18**（`docker-compose.yml`）。DDLは16以降で動く構文のみ使用 |
| API | TypeScript / Node.js 22, Hono, node-postgres, zod |
| マイグレーション | `db/migrations/*.sql` を素のSQLで管理し、`schema_migrations` に適用履歴を記録 |
| テスト | Vitest + 実PostgreSQL（`mikke_test` を毎回作り直す） |
| Web UI | React + Vite SPA（Step 2 以降） |
| 認証 | スコープ付きAPIトークン（SSOは後で差し込める構造） |

## 設計書からの補強・解釈

| # | 設計書 | 実装 |
|---|---|---|
| 1 | ER図 `relation_types.direction_semantics` と §4.10 の定義が不一致 | §4.10（`label` / `description` / `is_directed` / `is_active`）を正とした |
| 2 | `software_products` に一意制約なし | `UNIQUE(normalized_name, coalesce(lower(vendor), ''))` を追加。`created_at` / `updated_at` も追加 |
| 3 | 系列と製品の一致は「複合FKも検討」(§4.9a) | `software_release_cycles UNIQUE(id, software_product_id)` + 複合FKで DB 保証。`release_cycle_id` があるのに製品IDが NULL の状態も CHECK で禁止 |
| 4 | Resource と種別詳細の型一致は「ドメインサービスで保証」(§13) | 詳細テーブルに固定値の `resource_type` 列を持たせ、`(resource_id, resource_type)` の複合FKで DB でも保証 |
| 5 | 楽観ロック: §6.8 は「後日」、§12.2 は EOL で「MVP必須」 | EOL系（release cycle / lifecycle event の PUT）のみ `expected_updated_at` 必須。それ以外は後日 |
| 6 | `compute_assets.os_name/os_version` と `os_software_product_id` | 名前・版は「申告値」、製品ID/系列IDは「照合結果」として両方保持 |
| 7 | `relation_types` に導出種別を入れない | `hosted_on` / `deployed_on` / `managed_by` / `installed_on` / `sourced_from` を CHECK で禁止 |
| 8 | `match_pattern` は「安全な限定構文」 | カンマ区切りのバージョン接頭辞のみ（`8.4`, `1.24, 1.25`, `8.4.*`）。区切り境界で一致判定（`16` は `160` に一致しない）。NULLなら `cycle` を使用 |
| 9 | `assign_release_cycle` の対象は installation / service_instance | OS 用に `compute_os` を追加（`PUT /compute/{id}/os-release-cycle`）。§12.5 で OS 列を追加したため |
| 10 | 「稼働中の管理対象資産」(§12.0) | `archived_at IS NULL AND lifecycle_status <> 'retired'` |
| 11 | 無関係な系列の登録拒否 (§12.0-3) | 系列作成・イベント作成時に「その系列が稼働中資産に割当済み」または「同製品の稼働中資産のバージョンが照合規則に一致」を要求。`assign_to` 指定時は作成と割当を同一TX |
| 12 | 冪等処理 (§12.4) | 同一内容のイベント再登録は既存を 200 で返す。内容が違えば差分付き 409（上書きは PUT） |
| 13 | 既存EOL日付の変更は承認済み操作に限定 (§12.2-5) | `event_date` の変更は `mikke:eol:approve` スコープ必須。無ければ差分付き 403 `approval_required` |
| 14 | 認証情報をDBに格納しない (§1-6) | `attributes` の秘密っぽいキー（password/secret/token/api_key 等）と、`endpoint` / `repository_url` の userinfo を拒否 |
| 15 | アーカイブ済みResource | 新しい関係（配置・依存・導入・ホスト先・系列割当）を張れない（409 `resource_archived`）。既存の deployment の inactive 化などは可能 |
| 16 | `recorded_by` | 入力させず認証主体（トークンの `actor_id`）を記録 |
| 17 | API トークン保存先 | テーブルを増やさず環境変数 `MIKKE_API_TOKENS`（SHA-256 ハッシュのみ）で管理 |
| 18 | `diagram_hidden_edges` の掃除 (§4.14) | relation / app_repository の削除時、および `host_compute_id` 変更時に該当行を削除 |

## スコープと操作

| スコープ | 操作 |
|---|---|
| `mikke:read` | GET 全般 |
| `mikke:write` | 作成・更新、relation / application-repository の削除 |
| `mikke:eol:approve` | 既存 lifecycle event の日付変更 |
| `mikke:admin` | アーカイブ・復元（全スコープを包含） |

## Step 1 で未実装（後続）

- Graph API・Diagram API（Step 3: Canvas）
- MCP サーバー（Step 4）
- Web UI（Step 2）
- `application.runtime_requirement` と系列の適合チェック（§12.1 将来）
