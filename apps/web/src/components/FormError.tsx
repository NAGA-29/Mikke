import { ApiError } from '../api';

export function FormError({ error, scope = 'mikke:write' }: { error: unknown; scope?: 'mikke:read' | 'mikke:write' }) {
  if (!error) return null;
  // 入力値を含み得るサーバーメッセージやdetails全体は表示・記録しない。
  const status = error instanceof ApiError ? error.status : null;
  const explanations: Record<string, string> = {
    link_in_use: 'デプロイがこのアプリ↔Repoの組を参照しています。先にデプロイの使用Repoを変更・解除してください。',
    repository_not_linked: '使用Repoがアプリケーションにリンクされていません。先にアプリ↔Repoリンクを登録してください。',
    resource_archived: '選択した資産はアーカイブされています。アーカイブされていない資産を選択してください。',
    self_relation: '関係元と関係先は別の資産を選択してください。',
    invalid_deployment_target: '配置先はコンピュート、または hosting サービスを選択してください。',
    unknown_relation_type: '有効な関係種別を選択してください。',
  };
  const explanation = error instanceof ApiError ? explanations[error.code] : undefined;
  const message = status === 403 ? `この操作に必要な権限（${scope}）がありません。`
    : explanation ? explanation
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
