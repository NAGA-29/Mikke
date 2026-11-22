# Mikke TODO

最終更新: 2026-11-22（Step 2 ソフトウェア・EOL・承認・管理操作・監査 UI実装）
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
- UI の参考像は「一覧＋詳細の管理画面型」（左サイドナビ・フィルタ付き一覧・詳細ページ・フォーム編集）で確定

### Step 3: Graph API と Canvas
設計書 §5・§6・§10-3。

- [ ] Diagram API：`diagrams` / `diagram_nodes` / `diagram_hidden_edges` の CRUD（テーブルは作成済み、API は未実装）
- [ ] `GET /graph?diagram_id=` — 配置ノードと、正本から組み立てたエッジ（relation / deployment / hosting / app_repository）を返す。Graph 用に二重保存しない
- [ ] 表示ルール：両端が図にあるエッジだけ。非表示指定を除外。アーカイブ済みノードは淡色＋警告
- [ ] Canvas（React Flow）：接続の種類に応じて正本を更新する（§6 の 1〜7）
- [ ] 正本削除時の `diagram_hidden_edges` 掃除は実装済み。孤児を見つける定期チェックの SQL を用意する

### Step 4: 読み書き MCP
設計書 §9・§12.3・§12.4。

- [ ] MCP サーバー（公式 TypeScript SDK）。`apps/api` と同じ `services/*` を呼ぶ。直接SQLで更新しない
- [ ] 初期ツール：`search_resources`, `get_resource`, `get_application_deployments`, `get_resource_dependencies`, `get_resource_graph`, `search_software_installations`, `list_eol_status`, `get_software_lifecycle`, `create_resource`, `update_resource`, `create_software_release_cycle`, `update_software_release_cycle`, `create_lifecycle_event`, `update_lifecycle_event`, `assign_release_cycle`
- [ ] アーカイブ・関係削除・EOLイベント削除などの破壊的操作は公開しない
- [ ] Agent ごとのトークンとスコープ。書き込み用の認証情報をプロンプトやログに出さない
- [ ] Agent による EOL 調査フロー（§12.2）が API だけで完結することを確認する

### Step 5: DADADA・SHIORI との横断検証
別マイルストーン。着手前に連携の範囲をユーザーに確認する。

## 未決事項（ユーザーの判断が必要）

- [ ] SSO の方式（Google Workspace OIDC / GitHub OAuth など）。今はAPIトークンのみ
- [ ] 本番のデプロイ先と運用（DB のホスティング、バックアップ、トークンの配布方法）
- [x] Step 2 の UI の参考像 → 一覧＋詳細の管理画面型

## 技術的な宿題

- [ ] **CI がまだ無い**。GitHub Actions で PostgreSQL 18 のサービスコンテナを立て、`pnpm typecheck` と `pnpm test` を回す
- [ ] OpenAPI など API 仕様の機械可読な定義（UI と MCP の実装前にあると楽）
- [ ] EOL系以外の更新にも楽観ロック（`expected_updated_at`）を入れる（§6-8 で「後日」とされている）
- [ ] 資産と種別詳細の1:1整合（詳細行が欠けた資産）を見つける定期チェック SQL（§13）
- [ ] 一覧APIの総件数（今は `limit` / `offset` のみ）と、名前検索の高速化（`pg_trgm`、§8）

## 将来（MVP 外・設計書 §11）

CPE/purl と CVE 照合、EOL 情報の自動収集、SSH / AWS API による資産の自動収集、依存関係の影響分析、関係の属性（ポート・プロトコル等）と履歴、Canvas のリアルタイム共同編集。
