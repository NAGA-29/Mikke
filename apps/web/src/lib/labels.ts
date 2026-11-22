// API の内部コード（enum・種別名）を画面用の日本語表示名にする。未知の値はコードのまま返す（欠落を隠さない）。

const label = (map: Record<string, string>) => (code: string | null | undefined) => (code ? map[code] ?? code : '-');

/** 関係種別（relation_types.code。DB の label と同じ） */
export const relationLabel = label({
  depends_on: '依存', connects_to: '接続', uses: '利用', publishes_to: '発行', consumes_from: '購読',
});

/** ライフサイクルイベントの種別 */
export const eventTypeLabel = label({
  release: 'リリース', active_support_end: '通常サポート終了', security_support_end: 'セキュリティサポート終了', eol: 'サポート終了（EOL）',
});

/** 監査ログの操作 */
export const auditActionLabel = label({
  create: '作成', update: '更新', delete: '削除', archive: 'アーカイブ', restore: '復元',
  approve: '承認', reject: '却下', request_change: '変更依頼', supersede: '置換', assign_release_cycle: 'リリース系列の割当',
});

/** 監査ログの対象種別 */
export const auditEntityLabel = label({
  resource: '資産', resource_relation: '依存関係', application_repository: 'アプリ↔リポジトリ', deployment: 'デプロイ',
  software_product: 'ソフトウェア製品', software_installation: 'ソフトウェア導入', software_release_cycle: 'リリース系列',
  software_lifecycle_event: 'ライフサイクルイベント', lifecycle_event_change_request: '日付変更依頼',
  diagram: '構成図', diagram_node: '構成図ノード', diagram_hidden_edge: '構成図の非表示エッジ',
});

/** アプリ↔リポジトリのリンクの用途 */
export const purposeLabel = label({ source: 'アプリのソース', config: '設定', infra: 'インフラ構成', other: 'その他' });

/** デプロイの状態 */
export const deploymentStatusLabel = label({ active: '稼働中', inactive: '停止中' });

/** リリース系列の確認状態 */
export const verificationLabel = label({ unverified: '未確認', verified: '確認済み', disputed: '異論あり' });
