# Mikke 実装メモ（DB基本設計 v1.1 → Step 1 実装）

正本の設計は [db-basic-design-v1.1.md](./db-basic-design-v1.1.md)。ここには実装時に設計書を補強・解釈した点を記録する。

## 技術スタック

| 層 | 採用 |
|---|---|
| DB | **PostgreSQL 18 必須**（`uuidv7()` を使用。マイグレーションCLIは18未満を拒否） |
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
| 13 | 既存EOL日付の変更は承認済み操作に限定 (§12.2-5) | 承認待ちキュー `lifecycle_event_change_requests`（18本目のテーブル）を追加。下記参照 |
| 14 | 認証情報をDBに格納しない (§1-6) | `attributes` の秘密っぽいキー（password/secret/token/api_key 等）と、`endpoint` / `repository_url` の userinfo を拒否 |
| 15 | アーカイブ済みResource | 新しい関係（配置・依存・導入・ホスト先・系列割当）を張れない（409 `resource_archived`）。既存の deployment の inactive 化などは可能 |
| 16 | `recorded_by` | 入力させず認証主体（トークンの `actor_id`）を記録 |
| 17 | API トークン保存先 | テーブルを増やさず環境変数 `MIKKE_API_TOKENS`（SHA-256 ハッシュのみ）で管理 |
| 18 | `diagram_hidden_edges` の掃除 (§4.14) | relation / app_repository の削除時、および `host_compute_id` 変更時に該当行を削除 |

| 19 | UUID 初期値は `gen_random_uuid()` | PG18 の `uuidv7()`（時系列順。挿入効率とID順ソートのため）に変更 |
| 20 | unknown の条件「情報未確認」(§12.1) | 系列が `unverified` でも根拠付きの終了日があれば日付で判定し、`needs_verification: true` で注意表示。`disputed` のみ unknown |

## EOL日付変更の承認フロー

1. `mikke:eol:approve` を持たない主体（Agent等）が `PUT /software/lifecycle-events/{id}` で `event_date` を変えると、即時反映せず **202** と承認待ち（`pending`）の変更依頼を返す。差分付き。`change_note` で根拠を添えられる
2. 同じイベントに未決の依頼があれば旧依頼は `superseded`
3. 承認者が `POST /software/lifecycle-event-change-requests/{id}/approve` または `/reject`
4. 承認時は依頼時点の `updated_at` と一致することを確認（その後イベントが変わっていれば 409 `stale_update`）
5. 依頼者本人は決裁できない（API と DB の CHECK で二重に保証）
6. 反映後の `recorded_by` は調査・提案した主体、監査ログの `actor_id` は承認者。承認者自身の直接更新は即時反映

## スコープと操作

| スコープ | 操作 |
|---|---|
| `mikke:read` | GET 全般 |
| `mikke:write` | 作成・更新、relation / application-repository の削除 |
| `mikke:eol:approve` | 既存 lifecycle event の日付変更 |
| `mikke:admin` | アーカイブ・復元（全スコープを包含） |

## Step 1 で未実装（後続）

- Canvas UI（Step 3。Graph API・Diagram APIは下記のとおり実装済み）
- MCP サーバー（Step 4）
- `application.runtime_requirement` と系列の適合チェック（§12.1 将来）

## Step 2 ソフトウェア・EOL・管理 UI（2026-11-22）

- API・DB・依存パッケージの変更はない。入力項目は `services/software.ts` のスキーマに合わせ、系列・イベントの PUT は取得した `updated_at` 文字列を変換せず `expected_updated_at` に送る。日付変更の `pending_approval`（HTTP 202）は即時反映と区別して表示する。
- スコープ・現在の `actor_id` を返すAPIはないため、承認・管理者操作の表示は権限推測で制御しない。APIの403を案内する。承認／却下前に依頼者と差分を表示し、本人でないことを確認させ、`self_approval` には専用案内を表示する。最終的な権限・自己決裁の防止は既存APIが担う。
- EOLの「期限接近」はAPIの `approaching_eol`。「要確認」は `needs_verification` または `cycle_mismatch`。状態別件数・stale・要確認件数は現在のフィルタに一致する対象単位で数え、同じ資産のOSと導入ソフトは別件と明示する。期限や判定自体はWebで再計算しない。
- アーカイブ／復元の確認時には既存の参照一覧コンポーネントを読み取り専用で再利用する。最新の `/resources/{id}/references` の取得成功までは確認・実行を無効化し、再取得した場合は確認チェックをリセットする。
- 監査ログ画面は日時・主体・操作・対象と監査IDを表示し、任意の `before_data` / `after_data` は描画しない。根拠URLは認証情報・認証クエリらしい入力を消去して送信せず、既存データの表示時も隠す。なお、既存APIの `source_url` 用 `httpUrl` は userinfo を拒否するが認証クエリまでは拒否しないため、Web以外の入力経路への対応は別途必要。
- `pnpm typecheck` と `pnpm --filter @mikke/web build` を確認。開発サーバーが `listen EPERM` で起動できず、ブラウザーでの実操作・実API連携確認は未実施。


## Step 3 Graph / Diagram API（2026-11-22）

- 正本の変更はない。`GET /graph?diagram_id=...` は `{ diagram, nodes, edges }` を返す。単一SQLの同一スナップショットで図の存在・ノード・エッジを読む。nodes は配置行に `name` / `resource_type` / `lifecycle_status` / `archived_at` / `archived` を付加する。edges は `edge_kind` / `edge_record_id` / `source_resource_id` / `target_resource_id` / `label` / `details`。CanvasのエッジIDは `${edge_kind}:${edge_record_id}` として組み立て可能。hostingの元IDはサービスのResource ID。
- §5 の4正本から導出し、両端が配置済みかつ非表示指定のないエッジだけ返す。設計にstatusによる除外指定がないため、inactive deploymentも返し、`details.status` で判別する。deploymentの環境・revision、app_repositoryのpurpose、relationのdescriptionもdetailsに含める。アーカイブ済みノードと既存の関係は維持する。
- `GET/POST /diagrams`、`GET/PATCH/DELETE /diagrams/{id}`。一覧はlimit（既定100、最大500）/offset。viewportは空オブジェクトか `{x,y,zoom}`（有限数、zoom > 0）。`GET/POST /diagrams/{id}/nodes`、`GET/PATCH/DELETE /diagrams/{id}/nodes/{nodeId}`。PATCHは座標・display_optionsのみ（resource_id差替え不可）。新規配置は `requireResource` のFOR SHAREでアーカイブと直列化。既存配置は資産アーカイブ後も移動・除去可能。display_optionsは既存attributesと同様に秘密キーを拒否。
- `GET/POST /diagrams/{id}/hidden-edges`、`DELETE /diagrams/{id}/hidden-edges/{edge_kind}/{edge_record_id}`。POST入力は `{edge_kind, edge_record_id}`。集合の設定・解除として冪等（重複POSTも201、解除済みDELETEも204）で、実際の変更のみ監査する。複合PKのため監査のentity_idは図ID、before/afterに完全な複合キーを残す。エンドポイントが未配置でも正本が存在すれば非表示設定可。hostingはhost_compute_idがNULLなら存在しないエッジとして404。
- 非表示POSTは正本行のロック → 図のFOR UPDATEの順。relation/deploymentは正本行FOR SHARE、app_repositoryはアプリ行FOR SHARE → リンク行FOR SHARE、hostingは `requireResource(..., {allowArchived: true, lock: true})` でサービスのResource行FOR UPDATE。削除・ホスト変更が先なら再検証で404、非表示が先なら正本変更側の掃除に含まれる。配置・非表示の変更と図削除は図のFOR UPDATEで直列化する。ノードPATCH/DELETEは配置行にもFOR UPDATE。
- 図と表示設定は物理削除可（資産アーカイブとは別）。図削除時はカスケード前のノード・非表示設定も監査のbeforeに含め、資産・関係正本は保持する。すべての書き込みと監査は同一TX。read/writeスコープは既存と同じ。§6-8・既存補強#5どおり、Graph/Diagramへの楽観ロック追加は後日とする。
- §6 の正本操作の確認結果：relationはPOST/DELETE、app_repositoryはPOST/DELETE、hostingは `PATCH /resources/{service_id}` の `detail.host_compute_id`（NULLで解除）で対応済み。**不足していたdeploymentの関係削除を `DELETE /deployments/{id}` として追加**（§9のAPI列挙に対する追加、§6-7を満たすため）。deployment行FOR UPDATE → 削除・全図の非表示掃除・監査を同一TXで実行し、write権限で許可。既存PATCHによるinactive化も利用可能。既存制約（利用中のapp_repository削除拒否、アーカイブ済みサービスの編集には復元が必要）は維持する。
- 孤児検査は `db/checks/orphan_diagram_hidden_edges.sql` をDB運用の定期ジョブから実行する想定。読み取り専用で4種類を検査し、hostingのホスト未設定も検出する。ジョブのスケジューリング自体は今回の範囲外。
- `pnpm typecheck` 通過。`pnpm test` は実DB接続が `EPERM`（localhost:5432）でglobal setupに失敗し、追加9件を含むテスト本体は未実行。既存マイグレーション・依存パッケージ・Webは変更していない。
