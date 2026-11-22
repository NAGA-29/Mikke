# Mikke TODO

最終更新: 2026-11-22（Step 4 MCP実装、実DBテストは接続制限により未実行）
実装順序は設計書 §10 に従う。完了したらチェックを付け、日付と PR を書き添える。

## 現在の状態

- [x] **Step 1: DB + REST API + テスト**（[PR #1](https://github.com/NAGA-29/Mikke/pull/1)）
  - 18テーブル（設計の17 + EOL日付変更の承認待ちキュー）、PostgreSQL 18
  - 資産・関係・デプロイ・ソフトウェア・EOL・監査ログの REST API、スコープ付きトークン認証
  - 統合テスト35件（実DB）。§10 の受け入れ基準のうち API で確認できるものは網羅

## 次にやること

### Step 2: 手動登録・編集・検索 UI
設計書 §10-2。スタックは React + Vite SPA（`apps/web` を新設）。

- [x] `apps/web` の雛形（Vite + React + TypeScript）。API は `/api/v1` を呼ぶ（dev は `pnpm dev:web`、/api を :8080 へプロキシ）
- [x] 認証：当面はAPIトークンを入力して保持する簡易ログイン（SSOは未決、下記参照）
- [x] 資産一覧・検索（種別・環境・名前・アーカイブ含む）
- [x] 資産の詳細画面：共通項目・種別詳細・参照一覧（種別別の表、参照資産名から詳細へリンク）（2026-11-22、PR未作成）
- [x] 種別ごとの登録・編集フォーム（compute / application / service_instance / repository）（2026-11-22、PR未作成。型チェック・Webビルド通過。API回帰テストは実行環境のDB接続制限により未完了）
- [x] 依存関係の登録・削除（関係種別、名前検索付き資産選択、ページ内削除確認）（2026-11-22、PR未作成）
- [x] アプリ↔Repo の登録・削除（用途選択、ページ内削除確認）（2026-11-22、PR未作成）
- [x] デプロイの登録・編集（POST/PATCH、inactive化。削除APIはないため物理削除UIは設けない）（2026-11-22、PR未作成）
  - 上記参照・関係UIは `pnpm typecheck` / `pnpm --filter @mikke/web build` 通過。ブラウザー操作確認は環境のlisten制限（EPERM）とブラウザーツールの実行制限により未実施。
- [x] ソフトウェア導入の登録・編集、リリース系列の割当・解除（導入・サービス・OS）、製品一覧・登録・編集、資産詳細からの導線（2026-11-22、PR未作成）
- [x] EOL ダッシュボード（`/eol/status`：eol / approaching_eol / supported / unknown、stale・要確認フラグ、状態別件数とフィルタ）（2026-11-22、PR未作成）
- [x] EOL 日付変更の承認待ち一覧と承認・却下（`mikke:eol:approve` 保持者向け。自己決裁の注意・確認とAPIエラー案内）、系列・イベントの登録／更新（楽観ロック、202承認待ち表示）（2026-11-22、PR未作成）
- [x] アーカイブ・復元（admin のみAPIで許可。参照一覧を再取得し、取得成功後にページ内で確認）（2026-11-22、PR未作成）
- [x] 監査ログの閲覧（日時・主体・操作・対象、対象種別／ID・主体・取得件数フィルタ）（2026-11-22、PR未作成）
  - 上記UI・サイドナビは `pnpm typecheck` / `pnpm --filter @mikke/web build` 通過。API・依存パッケージの変更なし。ブラウザー操作確認は開発サーバーのlisten制限（`127.0.0.1:5173`、`EPERM`）により未実施。
- [x] UI整理：内部CMDB向けの固定・グループ別ナビ、現在地表示、CSS変数のデザイントークン、共通UI（ヘッダー・ボタン・バッジ・表・空／読込／エラー）、カード、2列フォーム、詳細の区切り、Canvas・確認UIを統一。フォーカス・ARIA・E2E用識別子を追加（2026-11-22、PR未作成）
  - ログインは `GET /api/v1/resources?limit=1` 成功後のみ sessionStorage に保存。表示切替・Enter送信・処理中表示、401／403／通信失敗の区別、通常APIの401でログインへ戻す処理を追加。認証以外のAPI呼出・検証・業務ロジックと依存関係は変更なし。
  - `pnpm typecheck` / `pnpm --filter @mikke/web build` 通過。ブラウザーの表示・キーボード操作・実API連携は未検証。
- [x] 資産フォームのホスト・サービス製品・OS製品を名前検索ピッカーに変更（未指定で解除、製品IDの名前解決、未変更の参照はPATCHから省略）。詳細のホスト先設定・変更・解除、コンピュートからのサービス追加・解除をページ内確認付きで実装（2026-11-22、PR未作成）
  - `pnpm typecheck` / `pnpm --filter @mikke/web build` 通過。E2Eを3件追加（サービスUI登録とホスト設定・解除、OS製品の保持・解除、ホスト上書きと行からの解除）。`pnpm test:e2e` はtsxのIPC用listenが `EPERM` でサーバー起動前に停止、テスト本体は **NOT RUN**。API・依存パッケージの変更なし。
- UI の参考像は「一覧＋詳細の管理画面型」（左サイドナビ・フィルタ付き一覧・詳細ページ・フォーム編集）で確定

### Step 3: Graph API と Canvas
設計書 §5・§6・§10-3。

- [x] Diagram API：`diagrams` / `diagram_nodes` / `diagram_hidden_edges` の CRUD（2026-11-22、PR未作成。write権限、監査、正本ロック付き非表示設定）
- [x] `GET /graph?diagram_id=`（2026-11-22、PR未作成）— 配置ノードと、正本から組み立てたエッジ（relation / deployment / hosting / app_repository）を返す。Graph 用に二重保存しない
- [x] API表示ルール：両端が図にあるエッジだけ。非表示指定を除外。アーカイブ済みノードに `archived` フラグ（2026-11-22、PR未作成）
- [x] Canvas表示：アーカイブ済みノードは淡色＋警告（2026-11-22、PR未作成）
- [x] Canvas（React Flow）：接続の種類に応じて正本を更新する（§6 の 1〜7）（2026-11-22、PR未作成）
  - `/diagrams` の一覧・作成・改名・削除、`/diagrams/:id` の配置・移動・除去、4種の色／ラベル、接続登録ダイアログ、図単位の非表示・再表示、正本削除の影響候補取得・確認。ズーム・ミニマップ・fit・表示範囲保存。変換・更新先選択・影響抽出は `apps/web/src/lib/graph.ts` の純粋関数。
  - `pnpm typecheck` / `pnpm --filter @mikke/web build` 通過。純粋関数のスモーク確認通過。開発サーバーは `listen EPERM`（127.0.0.1:5173）により起動できず、ブラウザー実操作・実API連携は未検証。API・DB・依存パッケージの追加変更なし。
- [x] 正本削除時の `diagram_hidden_edges` 掃除と孤児検査 SQL（`db/checks/orphan_diagram_hidden_edges.sql`、hosting解除も検出。2026-11-22、PR未作成）
  - §6 の正本操作を確認し、不足していた `DELETE /deployments/{id}` を追加（write権限、監査・非表示掃除は同一TX）。
  - 統合テスト9件追加。`pnpm typecheck` 通過。`pnpm test` はDB接続が `EPERM`（localhost:5432）となりglobal setupで停止、テスト本体は未実行。

### Step 4: 読み書き MCP
設計書 §9・§12.3・§12.4。

- [x] MCP サーバー（公式 TypeScript SDK）。`apps/api` と同じ `services/*` を呼ぶ。直接SQLで更新しない
- [x] 初期ツール：`search_resources`, `get_resource`, `get_application_deployments`, `get_resource_dependencies`, `get_resource_graph`, `search_software_installations`, `list_eol_status`, `get_software_lifecycle`, `create_resource`, `update_resource`, `create_software_release_cycle`, `update_software_release_cycle`, `create_lifecycle_event`, `update_lifecycle_event`, `assign_release_cycle`
- [x] アーカイブ・関係削除・EOLイベント削除などの破壊的操作は公開しない
- [x] Agent ごとのトークンとスコープ。書き込み用の認証情報をプロンプトやログに出さない
- [x] Agent による EOL 調査フロー（§12.2）が API だけで完結することを確認する（mcp.test.ts）

  - 2026-11-22、PR未作成。stdio起動・15ツール・共通認証・スコープ・同一TX監査・承認待ち・楽観ロックを実装。READMEに起動とクライアント設定を記載。
  - SDK Client/InMemoryTransport統合テスト7件を追加。`pnpm typecheck` 通過。DBなしのSDKスモーク（ツール列挙・権限不足・actor_id拒否）通過。`pnpm test` はDB接続がEPERMでglobal setup停止、テスト本体は **NOT RUN**。調査フロー完了確認は実DB環境で残作業。

### Step 5: DADADA・SHIORI との横断検証
別マイルストーン。着手前に連携の範囲をユーザーに確認する。

## 未決事項（ユーザーの判断が必要）

- [ ] SSO の方式（Google Workspace OIDC / GitHub OAuth など）。今はAPIトークンのみ
- [ ] 本番のデプロイ先と運用（DB のホスティング、バックアップ、トークンの配布方法）
- [x] Step 2 の UI の参考像 → 一覧＋詳細の管理画面型

## 技術的な宿題

- [x] CI：`.github/workflows/ci.yml`（typecheck・web ビルド・API テスト・Playwright e2e、PostgreSQL 18 サービスコンテナ）。**初回の GitHub 上での実行は未確認**（2026-11-22）。アクションは major タグ指定なので、コミット SHA 固定を検討
- [ ] OpenAPI など API 仕様の機械可読な定義（UI と MCP の実装前にあると楽）
- [ ] EOL系以外の更新にも楽観ロック（`expected_updated_at`）を入れる（§6-8 で「後日」とされている）
- [ ] 資産と種別詳細の1:1整合（詳細行が欠けた資産）を見つける定期チェック SQL（§13）
- [ ] 一覧APIの総件数（今は `limit` / `offset` のみ）と、名前検索の高速化（`pg_trgm`、§8）

## 将来（MVP 外・設計書 §11）

CPE/purl と CVE 照合、EOL 情報の自動収集、SSH / AWS API による資産の自動収集、依存関係の影響分析、関係の属性（ポート・プロトコル等）と履歴、Canvas のリアルタイム共同編集。

## e2e（Playwright）

- [x] `apps/e2e`：認証、資産の登録・編集・検索・アーカイブ、EOL ダッシュボードと承認、監査ログ、構成図 / Canvas（12件、2026-11-22）
- [ ] 未カバー：依存関係・デプロイ・アプリ↔Repo の登録削除、ソフトウェア導入と系列の割当、Canvas での接続・エッジ削除・ドラッグ保存、アーカイブ復元
- 見た目の確認：`SCREENSHOT_DIR=<dir> pnpm test:e2e tests/screens.spec.ts` で全画面のスクリーンショットを保存

- [x] 登録・編集・確認のインラインフォームを共通のネイティブdialogモーダルへ移行（保存中の閉鎖防止・フォーカス復元、デプロイ登録E2E追加、E2E未実行）。
