export interface Deployment {
  id: string;
  application_id: string;
  target_resource_id: string;
  repository_id: string | null;
  environment: string;
  deploy_path: string | null;
  deploy_method: string | null;
  revision: string | null;
  status: 'active' | 'inactive';
  deployed_at: string | null;
}

export interface Relation {
  id: string;
  source_resource_id: string;
  target_resource_id: string;
  relation_type: string;
  description: string | null;
}

export interface AppRepository {
  id: string;
  application_id: string;
  repository_id: string;
  purpose: 'source' | 'config' | 'infra' | 'other';
}

export interface RelationType {
  code: string;
  label: string;
  description: string | null;
  is_directed: boolean;
  is_active: boolean;
}

export interface Installation {
  id: string;
  compute_asset_id: string;
  software_product_id: string;
  release_cycle_id: string | null;
  version: string | null;
  install_method: string | null;
  install_path: string | null;
  config_path: string | null;
  last_verified_at: string | null;
}

export interface ResourceReferencesData {
  deployments_as_application: Deployment[];
  deployments_as_target: Deployment[];
  deployments_as_repository: Deployment[];
  hosted_services: { id: string; name: string; archived_at: string | null }[];
  host: { id: string; name: string; archived_at: string | null } | null;
  relations_out: Relation[];
  relations_in: Relation[];
  application_repositories: AppRepository[];
  software_installations: Installation[];
  diagram_ids: string[];
}
