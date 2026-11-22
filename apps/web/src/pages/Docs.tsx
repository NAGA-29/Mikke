import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';

// アプリ内の簡易ドキュメント。操作の説明は画面の文言・仕様（docs/db-basic-design-v1.1.md）と食い違わないようにする。
const TOC = [
  ['overview', 'Mikke とは'],
  ['quickstart', 'はじめに（最短の流れ）'],
  ['resources', '資産の種類と登録'],
  ['links', '関係・デプロイ・ホスト先'],
  ['software', 'ソフトウェアと EOL'],
  ['approval', 'EOL 日付の変更と承認'],
  ['diagrams', '構成図（Canvas）'],
  ['archive', 'アーカイブと監査ログ'],
  ['access', 'トークンと権限'],
  ['mcp', 'Agent 連携（MCP）'],
  ['glossary', '用語集'],
] as const;

export function Docs() {
  return <section className="docs">
    <PageHeader title="ドキュメント" />
    <div className="docs-layout">
      <nav className="docs-toc" aria-label="目次">
        <p className="docs-toc-title">目次</p>
        <ul>{TOC.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ul>
      </nav>
      <article className="prose" data-testid="docs-body">
        <h2 id="overview">Mikke とは</h2>
        <p>社内専用の軽量 CMDB です。サーバー・アプリ・サービス・リポジトリといった<strong>資産</strong>と、その<strong>つながり</strong>、
          動いている<strong>ソフトウェアのサポート期限（EOL）</strong>を一か所で管理します。「このサーバーに何が載っているか」
          「この DB を使っているアプリはどれか」「どの Node.js がもうすぐ EOL か」に答えられることが目的です。</p>
        <p>同じ事実は<strong>一か所にだけ</strong>記録します。例えばデプロイの事実はデプロイ、ホスト先はサービス側の「ホスト先」にだけ保存され、
          構成図や参照一覧はそこから組み立てて表示します。そのため、どの画面で変更しても全体に反映されます。</p>

        <h2 id="quickstart">はじめに（最短の流れ）</h2>
        <ol>
          <li><Link to="/resources/new">資産を登録</Link>する（コンピュート → サービス → アプリ → リポジトリの順だと関連づけが楽です）。</li>
          <li>資産の詳細画面で、<strong>ホスト先</strong>・<strong>デプロイ</strong>・<strong>依存関係</strong>を登録する。</li>
          <li><Link to="/software/installations">ソフトウェア導入</Link>を登録し、<Link to="/software/release-cycles">サポート期限</Link>で系列と終了日を登録する。</li>
          <li><Link to="/eol">EOL 状況</Link>で、期限が近い・過ぎているものを確認する。</li>
          <li><Link to="/diagrams">構成図</Link>に資産を並べて、全体を見渡す。</li>
        </ol>

        <h2 id="resources">資産の種類と登録</h2>
        <table>
          <thead><tr><th>種類</th><th>内容</th><th>主な項目</th></tr></thead>
          <tbody>
            <tr><td>コンピュート</td><td>サーバー実体（VPS・VM・EC2・ベアメタル・コンテナホスト）</td><td>ホスト名、OS、IP、プロバイダー</td></tr>
            <tr><td>サービス</td><td>DB・キャッシュ・キュー・ストレージなどの稼働中のもの</td><td>種別、エンジンとバージョン、ホスト先、エンドポイント</td></tr>
            <tr><td>アプリケーション</td><td>自社で作って動かすアプリ</td><td>フレームワーク、ランタイム、ビルドツール</td></tr>
            <tr><td>リポジトリ</td><td>ソースコードの置き場</td><td>URL、既定ブランチ</td></tr>
          </tbody>
        </table>
        <ul>
          <li><Link to="/resources">資産一覧</Link>の「新規登録」から登録します。種別を選ぶと、その種別の詳細項目が表示されます。</li>
          <li>環境は <code>prod</code> / <code>stg</code> / <code>dev</code> のような英小文字の名前で入力します。</li>
          <li>日時の入力欄は<strong>ブラウザのタイムゾーン</strong>で入力・表示されます（内部では UTC で保存）。</li>
          <li><strong>パスワード・トークンなどの認証情報は入力しないでください。</strong>URL に認証情報が含まれる場合などは登録を拒否します。</li>
        </ul>

        <h2 id="links">関係・デプロイ・ホスト先</h2>
        <p>資産の詳細画面の「参照」で、その資産に関わるつながりを確認・登録できます。登録はモーダル（ポップアップ）で行います。</p>
        <table>
          <thead><tr><th>つながり</th><th>意味</th><th>登録場所</th></tr></thead>
          <tbody>
            <tr><td>ホスト先</td><td>サービスがどのコンピュート上で動いているか</td><td>サービス詳細の「種別ごとの詳細」の「ホスト先」行</td></tr>
            <tr><td>デプロイ</td><td>どのアプリを、どのコンピュートに、どのリポジトリから配置したか</td><td>アプリ詳細の「デプロイを登録」</td></tr>
            <tr><td>依存関係</td><td>アプリやサービス間の通信・論理的な依存（依存・接続・利用・発行・購読）</td><td>「この資産からの関係／この資産への関係を登録」</td></tr>
            <tr><td>アプリ↔リポジトリ</td><td>アプリのソースや設定がどのリポジトリにあるか</td><td>アプリまたはリポジトリ詳細の「リンクを登録」</td></tr>
          </tbody>
        </table>
        <p>削除は、行の「削除」から確認画面を経て実行します。資産そのものは消えず、つながりだけが外れます。</p>

        <h2 id="software">ソフトウェアと EOL</h2>
        <p>EOL 管理は次の 4 つの登録でできています。</p>
        <ol>
          <li><strong>ソフトウェア製品</strong>：Node.js、PostgreSQL などの製品名（<Link to="/software/products">ソフトウェア製品</Link>）。</li>
          <li><strong>ソフトウェア導入</strong>：どのコンピュートにどの製品の何版を入れているか（<Link to="/software/installations">ソフトウェア導入</Link>）。</li>
          <li><strong>リリース系列</strong>：製品のバージョンの区切り（Node.js の <code>22</code>、PostgreSQL の <code>16</code> など）。導入に割り当てます。</li>
          <li><strong>ライフサイクルイベント</strong>：系列の節目の日付（リリース、通常サポート終了、セキュリティサポート終了、EOL）。
            <strong>根拠 URL と確認日時が必須</strong>です。2 と 3 と 4 は <Link to="/software/release-cycles">サポート期限</Link>で扱います。</li>
        </ol>
        <p>系列は、<strong>稼働中の資産が使っているもの</strong>だけ登録できます（使われていない製品を網羅するデータベースは作りません）。</p>
        <h3>EOL 状況の見方</h3>
        <table>
          <thead><tr><th>状態</th><th>意味</th></tr></thead>
          <tbody>
            <tr><td>EOL</td><td>終了日を過ぎている</td></tr>
            <tr><td>期限接近</td><td>終了日まで 90 日以内（既定）</td></tr>
            <tr><td>サポート中</td><td>終了日まで余裕がある</td></tr>
            <tr><td>不明</td><td>系列が未割当、終了日が未登録、版が系列と一致しない、など判定できない</td></tr>
          </tbody>
        </table>
        <p>終了日は、EOL の日付があればそれを、なければセキュリティサポート終了の日付を使います。
          根拠の確認日時が 180 日（既定）より古いものには「情報が古い」の印が付きます。</p>
        <p><strong>公式に明示されていない終了日は登録しないでください。</strong>不明な日付は「不明」のままにするのが正しい状態です。</p>

        <h2 id="approval">EOL 日付の変更と承認</h2>
        <p>既存の EOL 日付を変更するには、<code>mikke:eol:approve</code> の権限が必要です。権限のない人が日付を変更しようとすると、
          すぐには反映されず<strong>承認待ち</strong>になります。</p>
        <ol>
          <li>変更の提案者が、変更理由とともに保存する（承認待ちになる）。</li>
          <li>承認権限のある<strong>別の担当者</strong>が <Link to="/software/lifecycle-event-change-requests">承認待ち</Link>で差分を確認し、承認または却下する。</li>
          <li>承認すると正本の日付が更新される。<strong>依頼者本人は決裁できません。</strong></li>
        </ol>
        <p>日付以外（確認日時・メモ）の更新は、書き込み権限があれば直接できます。他の人が先に更新していた場合は「古い情報を更新しようとしている」旨のエラーになるので、画面を読み込み直して差分を確認してください。</p>

        <h2 id="diagrams">構成図（Canvas）</h2>
        <p><Link to="/diagrams">構成図</Link>では、資産を並べて関係を線で見られます。線は<strong>関係・デプロイ・ホスト先・アプリ↔リポジトリ</strong>から自動で作られ、
          図専用のデータは持ちません（位置と表示設定だけを保存します）。</p>
        <ul>
          <li>資産を図に追加し、ドラッグで配置します。位置は自動で保存されます。</li>
          <li>両端の資産が図にあるときだけ線が表示されます。アーカイブ済みの資産は薄く表示されます。</li>
          <li>ノードどうしを線でつなぐと、つなぎ方（依存・デプロイ・ホスト先・リポジトリリンク）を選んで<strong>正本を登録</strong>できます。</li>
          <li>線の操作は 2 種類あります。<strong>「この図で隠す」</strong>は図の見た目だけを変えます。
            <strong>「正本の削除・解除を確認」</strong>は実データを消す（ホスト先の場合は解除する）ので、<strong>すべての図・参照一覧から消えます</strong>（確認画面が出ます）。</li>
        </ul>

        <h2 id="archive">アーカイブと監査ログ</h2>
        <ul>
          <li>資産は<strong>物理削除されません</strong>。不要になった資産は<strong>アーカイブ</strong>します（<code>mikke:admin</code> 権限）。
            実行前に、その資産を参照しているものの一覧が表示されます。アーカイブした資産は復元できます。</li>
          <li>アーカイブ済みの資産は、一覧で既定では表示されません（「アーカイブを含む」で表示）。関連レコードと履歴は残ります。</li>
          <li><Link to="/audit-logs">監査ログ</Link>には、すべての変更が「誰が・いつ・何を」で記録されます。資産ごとの履歴は、詳細画面の「監査ログ」から見られます。</li>
        </ul>

        <h2 id="access">トークンと権限</h2>
        <p>ログインには API トークンを使います。トークンはこのブラウザのタブにだけ保存され、タブを閉じると消えます。発行は管理者が行います（<code>pnpm --filter @mikke/api token</code>）。</p>
        <table>
          <thead><tr><th>権限</th><th>できること</th></tr></thead>
          <tbody>
            <tr><td><code>mikke:read</code></td><td>すべての参照</td></tr>
            <tr><td><code>mikke:write</code></td><td>登録・更新、関係・リンクの削除</td></tr>
            <tr><td><code>mikke:eol:approve</code></td><td>EOL 日付変更の承認・却下、日付の直接変更</td></tr>
            <tr><td><code>mikke:admin</code></td><td>アーカイブ・復元（上のすべての権限を含む）</td></tr>
          </tbody>
        </table>
        <p>権限が足りない操作は、画面にエラーが表示されます。</p>

        <h2 id="mcp">Agent 連携（MCP）</h2>
        <p>AI Agent が EOL を調べて登録・更新できるよう、MCP サーバーを用意しています。Web 画面と同じ業務ルール・監査ログ・承認フローが適用されます。</p>
        <ul>
          <li>起動：<code>pnpm --silent --filter @mikke/api mcp</code>（stdio）。環境変数 <code>DATABASE_URL</code>、<code>MIKKE_API_TOKENS</code>、<code>MIKKE_MCP_TOKEN</code> が必要です。</li>
          <li>Agent ごとにトークンを発行し、<code>mikke:read</code> と <code>mikke:write</code> のみを付けるのが通常です。</li>
          <li>公開されているのは参照と登録・更新のツールだけで、アーカイブや削除はできません。</li>
          <li>Agent による日付の変更は承認待ちになり、人が承認します。</li>
        </ul>
        <p>設定例の詳細はリポジトリの <code>README.md</code> を参照してください。</p>

        <h2 id="glossary">用語集</h2>
        <dl className="glossary">
          <dt>資産</dt><dd>管理対象の実体。コンピュート・サービス・アプリケーション・リポジトリの 4 種類。</dd>
          <dt>正本</dt><dd>ある事実を記録している唯一の場所。構成図や参照一覧は正本から組み立てた表示です。</dd>
          <dt>EOL</dt><dd>End of Life。メーカーによるサポート（特にセキュリティ修正）の終了。</dd>
          <dt>リリース系列</dt><dd>製品のバージョンの区切り。例：Node.js 22.x → 系列「22」。</dd>
          <dt>ライフサイクルイベント</dt><dd>系列の節目となる日付（リリース、通常サポート終了、セキュリティサポート終了、EOL）。</dd>
          <dt>承認待ち</dt><dd>権限のない人が提案した EOL 日付の変更。別の担当者の承認で反映される。</dd>
          <dt>アーカイブ</dt><dd>資産を削除せずに「使わない」状態にすること。履歴は残り、復元できる。</dd>
          <dt>ホスト先</dt><dd>サービスが動いているコンピュート。</dd>
        </dl>
      </article>
    </div>
  </section>;
}
