import type { ResourceType } from '../api';

// 資産の種別ごとの詳細項目の定義（入力フォームと詳細表示で共有する）。
// 入力項目の正本: apps/api/src/services/resources.ts の各 detail スキーマ。
export type Field = { name: string; label: string; max?: number; required?: boolean; options?: string[]; kind?: 'attributes' | 'boolean'; hint?: string };
export const fields: Record<ResourceType, Field[]> = {
  compute: [
    { name: 'asset_kind', label: '資産種別', required: true, options: ['vps', 'vm', 'ec2', 'baremetal', 'container_host'] },
    { name: 'hostname', label: 'ホスト名', max: 255 },
    { name: 'display_alias', label: '管理用別名', max: 255 },
    { name: 'provider', label: 'プロバイダー', max: 100 },
    { name: 'region', label: 'リージョン / DC', max: 100 },
    { name: 'os_name', label: 'OS名', max: 100 },
    { name: 'os_version', label: 'OSバージョン', max: 100 },
    { name: 'os_software_product_id', label: 'OS製品ID', hint: '製品名で検索して選択。指定なしで解除できます。' },
    { name: 'architecture', label: 'アーキテクチャ', max: 32 },
    { name: 'public_ip', label: '公開IP', hint: 'IPv4 / IPv6' },
    { name: 'private_ip', label: '内部IP', hint: 'IPv4 / IPv6' },
    { name: 'attributes', label: '属性（JSONオブジェクト）', kind: 'attributes' },
  ],
  application: [
    { name: 'framework', label: 'フレームワーク', max: 100 },
    { name: 'framework_version', label: 'フレームワークバージョン', max: 100 },
    { name: 'runtime', label: 'ランタイム', max: 100 },
    { name: 'runtime_requirement', label: '要求バージョン範囲', max: 100 },
    { name: 'build_tool', label: 'ビルドツール', max: 100 },
    { name: 'attributes', label: '属性（JSONオブジェクト）', kind: 'attributes' },
  ],
  service_instance: [
    { name: 'service_kind', label: 'サービス種別', required: true, options: ['database', 'cache', 'queue', 'storage', 'hosting', 'other'] },
    { name: 'engine', label: 'エンジン', max: 100 },
    { name: 'engine_version', label: 'エンジンバージョン', max: 100 },
    { name: 'software_product_id', label: 'ソフトウェア製品ID', hint: '製品名で検索して選択。指定なしで解除できます。' },
    { name: 'provider', label: 'プロバイダー', max: 100 },
    { name: 'is_managed', label: 'マネージドサービス', kind: 'boolean' },
    { name: 'host_compute_id', label: 'ホスト先', hint: 'アーカイブされていないコンピュートを名前で検索。指定なしで解除できます。' },
    { name: 'endpoint', label: 'エンドポイント', max: 1024 },
    { name: 'attributes', label: '属性（JSONオブジェクト）', kind: 'attributes' },
  ],
  repository: [
    { name: 'provider', label: 'プロバイダー', max: 50 },
    { name: 'repository_url', label: 'リポジトリURL', max: 2048, required: true, hint: 'HTTPS / HTTP / SSH / Git URL または git@host:owner/repo.git' },
    { name: 'default_branch', label: '既定ブランチ', max: 255 },
  ],
};

/** 選択肢の表示名（値は API の enum のまま送る） */
export const ENUM_LABELS: Record<string, Record<string, string>> = {
  asset_kind: { vps: 'VPS', vm: '仮想マシン（VM）', ec2: 'EC2', baremetal: 'ベアメタル', container_host: 'コンテナホスト' },
  service_kind: { database: 'データベース', cache: 'キャッシュ', queue: 'キュー', storage: 'ストレージ', hosting: 'ホスティング', other: 'その他' },
};
export const enumLabel = (name: string, value: string) => ENUM_LABELS[name]?.[value] ?? value;

/** 表示名に変換して見せるID項目（UUIDをそのまま見せない） */
export const REFERENCE_FIELDS = { host_compute_id: 'resource', software_product_id: 'product', os_software_product_id: 'product' } as const;
/** 詳細表示では出さない項目（リリース系列は「リリース系列の割当」欄に表示される） */
export const HIDDEN_DETAIL_FIELDS = new Set(['release_cycle_id', 'os_release_cycle_id']);
