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

- Canvas UIはStep 3で実装済み（下記参照）。ブラウザーでの実操作確認は未実施。
- MCP サーバーはStep 4で実装済み（下記参照）。実DBでの調査フロー確認は未実施。
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


## Step 3 Canvas UI（2026-11-22）

- §5・§6の正本ルールの変更はない。`apps/web` のReact Flow UIはGraphの4種のエッジを色・ラベルで区別し、同じ両端の複数エッジは曲線を分けて選択可能にする。接続ダイアログからrelation / deployment / hosting / app_repositoryの既存APIを呼ぶ。線はAPI成功後のGraph再取得で確定する。接続種別は資産型から初期候補を示すだけで、全種別を選択可能とし、不正な組合せ・重複・権限エラーはHTTPステータス・code・messageをそのまま表示する（任意のdetailsや資産レコード全体は表示・ログ出力しない）。デプロイでは環境・状態・使用Repoを入力し、その他の任意項目は既存の資産詳細から編集できる。
- ノードの追加・除去は配置のみ。位置はドラッグ後500msでPATCHし、バッチを直列化する。失敗は表示して再試行可能。画面遷移時も保存待ちの移動を送信するが、タブ終了時の配送保証はない。ズーム・ミニマップ・fitを備え、表示範囲は明示的な保存ボタンでdiagram.viewportへ保存する。Canvasは遅延ロードする。
- 正本削除前は一覧を全ページ取得し、各図のGraphを最大5並列で読み、両端が配置されている図（表示中／非表示または変更済み）を影響候補として表示する。app_repositoryの場合は同じアプリ・Repoを参照するデプロイ件数も表示する。全図・MCPへの反映と非表示設定の掃除を明示し、確認チェック後に実行する。影響取得が失敗した場合は削除不可とする。図内非表示・再表示は別操作。
- 既存APIには原子的な影響確認・削除やhosting解除の比較条件付きPATCHはない。影響は取得時点の候補であり、確認後の並行変更を固定しない。hosting解除直前には現在のhost_compute_idを再取得し、変わっていれば409相当で中止するが、取得からPATCHまでの競合は§6-8の将来の楽観ロック課題として残る。APIは変更していない。
- 認証は既存のAPIクライアントを利用し、新しいトークン保存先やログ出力を追加しない。追加依存なし（作業開始時に導入済みの `@xyflow/react@12.12.1` を使用）。`pnpm typecheck`・Webビルドと純粋関数のスモーク確認は通過。開発サーバーの `listen EPERM` によりブラウザー実操作・実API連携は未検証。

## Step 4 読み書き MCP（2026-11-22）

- 公式SDK 1.32.2（作業開始時に導入済み）のMcpServer/registerToolとstdioを使用。追加依存なし。指定15ツールのみ公開し、adminにも削除・アーカイブ・承認ツールは公開しない。起動は `node --import tsx`、`.env` は読み込まない。stdoutはプロトコル専用、ログは固定文でstderrへ出す。
- RESTのトークン照合をresolveActorに抽出して共用。MIKKE_MCP_TOKENを起動時に検証し、認証主体・スコープはプロセスに固定。actor_id/recorded_by引数はstrictスキーマで拒否する。verified_byは既存サービスの確認者メタデータであり、監査actorを変更しない。
- 書き込みは全て既存サービス＋withTx。EOLスキーマをexportして共有し、業務ルール・ロック順序は変更しない。引数はinputにREST本文、更新にはid、割当にはtarget_kind/target_id。EOL更新は全更新＋expected_updated_at（マイクロ秒保持）。
- 結果はtext/structuredContentにstatus/status_code/data。承認待ちはpending_approval、202、依頼と変更前後を返し、正本未反映を明示する。AppError/PG制約違反はisErrorとcode/message/statusに変換。例外が入力値を含む場合に備え、権限不足・stale_update以外はコード付き固定メッセージとし、任意のdetailsやSQLエラー本文は返さない。出力の認証情報らしいキー・認証付きURL・当該生トークンは防御的に伏せる。transport送信時にも適用し、SDK自身の入力検証エラーに未知の引数名として混入した生トークンも伏せる。
- §9に従いget_resource_graphはdiagram_idで既存Graphサービスを使う。get_resource_dependenciesはgetReferencesの入出力relation・deployment・hosting・app-repo・導入・図参照を返す。get_application_deploymentsはアプリ種別を確認する。
- 製品作成・導入作成は指定ツールにないため公開しない。調査は既存製品が前提。get_software_lifecycleは製品検索（q/software_product_id）と系列・イベント取得を合成し、系列未登録の製品も発見できる。テストは製品のみ事前登録し、その検索→対象サービス資産作成→系列→イベント→割当→EOL再取得をMCPだけで行う。
- 不明な日付の捏造禁止・公式に明示されていない終了日を登録しないルールをEOLツール説明に記載。公式情報の正否はAgentが確認し、サーバーはsource_urlを取得しない。MCPのsource_urlには既存httpUrlにendpointの認証クエリ拒否を併用する（RESTの規則は変更していない）。
- pnpm typecheck通過。DBなしのSDK Client/InMemoryTransportスモーク（15ツール列挙、権限不足、actor_id拒否）通過。pnpm testはlocalhost:5432接続がEPERMでglobal setup停止、追加統合テストを含め本体は **NOT RUN**。実DBで§12.2の完了確認が残る。

## 組織名の匿名化（2026-11-22）

- リポジトリ内の組織を特定できる表記を置き換えた。会社名は「社内専用」「自社」、連携先の製品名は「脆弱性管理基盤」「別の連携システム」、GitHub のアカウント名入りURLは削除した。対象は README、CLAUDE.md、ログイン画面、アプリ内ドキュメント、テストのURL（架空の `example-org`）。
- 正本である `docs/db-basic-design-v1.1.md` も、会社名の箇所だけ最小限に書き換えた（仕様の内容は変更していない）。ユーザーの明示的な指示による変更。
- 過去のコミット履歴には元の表記が残っている（履歴の書き換えは行っていない）。

## Canvas の形状・線種（2026-11-22）

- ノードの形状は保存しない。資産種別と細分類（`compute_assets.asset_kind` / `service_instances.service_kind`）から表示時に導出する（`web/src/lib/graph.ts` の `nodeShape`）。DB スキーマと設計の正本は変更していない。
- そのため `GET /graph` のノードに表示用の `kind`（コンピュートは asset_kind、サービスは service_kind、他は null）を追加した。正本の複製ではなく、JOIN で参照するだけ。
- エッジの線種・矢印は `edge_kind` と relation_type（`label`）から導出する（`edgeLook`）。波線は発行・購読（publishes_to / consumes_from）。凡例も同じ関数から描く。
- 線の線種・矢印は、図ごとに上書きできる（`diagram_edge_styles`、マイグレーション 0003）。正本の関係は変えず、他の図にも影響しない。未設定は上記の既定。API は `GET/PUT /diagrams/{id}/edge-styles`、`DELETE /diagrams/{id}/edge-styles/{kind}/{recordId}`（write）。`GET /graph` の各エッジに `style`（未設定は null）を含める。ロック順は hidden-edges と同じ（正本 → 図）。変更は監査ログ（`diagram_edge_style`）に残り、図の削除時は削除前の内容を監査に残す。
- 正本の関係が削除されると上書き行は孤児として残る（hidden-edges と同じ扱い）。`db/checks/orphan_diagram_edge_styles.sql` で検出できる。
- ノード形状の上書きは入れていない（資産の細分類から導出するのみ）。
