import { ApiError } from '../api';

export function FormError({ error, scope = 'mikke:write' }: { error: unknown; scope?: 'mikke:read' | 'mikke:write' | 'mikke:eol:approve' | 'mikke:admin' }) {
  if (!error) return null;
  // 入力値を含み得るサーバーメッセージやdetails全体は表示・記録しない。
  const status = error instanceof ApiError ? error.status : null;
  const explanations: Record<string, string> = {
    self_approval: '依頼者本人は承認・却下できません。別の承認権限を持つ担当者に決裁を依頼してください。',
    stale_update: '他の更新がありました。再読み込みして最新の内容を確認し、編集し直してください。承認時の場合は依頼を却下して再提案してください。',
    not_pending: 'この依頼は決裁済みか、新しい依頼で置き換えられています。再読み込みしてください。',
    version_mismatch: 'バージョンと系列の照合規則が一致しません。内容を確認してください。',
    product_mismatch: '選択した系列の製品が割当先の製品と異なります。',
    product_not_set: '先に資産の編集画面で製品を指定してください。',
    release_cycle_not_in_use: '稼働中の資産が使用する系列だけ登録できます。導入・OS・サービスの製品とバージョン、または作成時の割当先を確認してください。',
    cycle_not_matchable: '系列名をバージョン接頭辞にするか、照合規則を指定してください（例: 8.4 または 1.24, 1.25）。',
    link_in_use: 'デプロイがこのアプリ↔Repoの組を参照しています。先にデプロイの使用Repoを変更・解除してください。',
    repository_not_linked: '使用Repoがアプリケーションにリンクされていません。先にアプリ↔Repoリンクを登録してください。',
    resource_archived: '選択した資産はアーカイブされています。アーカイブされていない資産を選択してください。',
    self_relation: '関係元と関係先は別の資産を選択してください。',
    invalid_deployment_target: '配置先はコンピュート、または hosting サービスを選択してください。',
    unknown_relation_type: '有効な関係種別を選択してください。',
  };
  const explanation = error instanceof ApiError ? explanations[error.code] : undefined;
  const message = explanation ? explanation
    : status === 403 ? `この操作に必要な権限（${scope}）がありません。`
    : status === 409 ? '重複・アーカイブ・使用中の参照などにより保存できません。最新の参照と選択資産を確認してください。'
    : status === 422 ? '入力内容が条件を満たしていません。必須項目・種別・関連付けを確認してください。'
    : '操作に失敗しました。接続や認証状態を確認して再試行してください。';
  const paths = error instanceof ApiError && Array.isArray(error.details)
    ? error.details.flatMap((issue: unknown) => {
      if (!issue || typeof issue !== 'object' || !('path' in issue) || typeof issue.path !== 'string') return [];
      return /^[a-z_]+$/.test(issue.path) ? [issue.path] : [];
    }) : [];
  return <div className="error" role="alert"><p>{status && `HTTP ${status}: `}{message}</p>
    {paths.length > 0 && <p>確認する項目: {paths.join(', ')}</p>}
  </div>;
}
