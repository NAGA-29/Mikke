-- Mikke DB basic design v1.1 — initial schema (17 tables)
-- 正本: docs/db-basic-design-v1.1.md
-- 要件: PostgreSQL 18 以上（uuidv7()）。設計書からの補強点は docs/implementation-notes.md を参照。

-- ---------------------------------------------------------------------------
-- 共通: updated_at 自動更新
-- ---------------------------------------------------------------------------
CREATE FUNCTION mikke_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. resources
-- ---------------------------------------------------------------------------
CREATE TABLE resources (
  id               uuid         PRIMARY KEY DEFAULT uuidv7(),
  resource_type    varchar(32)  NOT NULL
                   CHECK (resource_type IN ('compute', 'application', 'service_instance', 'repository')),
  name             varchar(255) NOT NULL,
  description      text,
  environment      varchar(32),
  lifecycle_status varchar(32)  NOT NULL DEFAULT 'active'
                   CHECK (lifecycle_status IN ('active', 'maintenance', 'retired')),
  last_verified_at timestamptz,
  archived_at      timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  -- 種別詳細テーブルから (id, resource_type) で参照し、種別一致をDBで保証する
  UNIQUE (id, resource_type)
);
CREATE TRIGGER resources_updated_at BEFORE UPDATE ON resources
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();
CREATE INDEX resources_type_archived_idx ON resources (resource_type, archived_at);
CREATE INDEX resources_name_idx ON resources (name);

-- ---------------------------------------------------------------------------
-- 8. software_products
-- ---------------------------------------------------------------------------
CREATE TABLE software_products (
  id              uuid         PRIMARY KEY DEFAULT uuidv7(),
  name            varchar(255) NOT NULL,
  normalized_name varchar(255) NOT NULL,
  vendor          varchar(255),
  category        varchar(50),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE TRIGGER software_products_updated_at BEFORE UPDATE ON software_products
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();
-- 同名でも vendor 違いは許容。vendor 未指定同士の重複は防ぐ
CREATE UNIQUE INDEX software_products_identity_uq
  ON software_products (normalized_name, (coalesce(lower(vendor), '')));

-- ---------------------------------------------------------------------------
-- 16. software_release_cycles
-- ---------------------------------------------------------------------------
CREATE TABLE software_release_cycles (
  id                  uuid         PRIMARY KEY DEFAULT uuidv7(),
  software_product_id uuid         NOT NULL REFERENCES software_products (id),
  cycle               varchar(100) NOT NULL,
  match_pattern       varchar(255),
  verification_status varchar(32)  NOT NULL DEFAULT 'unverified'
                      CHECK (verification_status IN ('unverified', 'verified', 'disputed')),
  verified_at         timestamptz,
  verified_by         varchar(255),
  notes               text,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (software_product_id, cycle),
  -- 複合FKで「系列は同じ製品に属する」ことをDBで保証するための一意キー
  UNIQUE (id, software_product_id)
);
CREATE TRIGGER software_release_cycles_updated_at BEFORE UPDATE ON software_release_cycles
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();

-- ---------------------------------------------------------------------------
-- 17. software_lifecycle_events
-- ---------------------------------------------------------------------------
CREATE TABLE software_lifecycle_events (
  id               uuid         PRIMARY KEY DEFAULT uuidv7(),
  release_cycle_id uuid         NOT NULL REFERENCES software_release_cycles (id),
  event_type       varchar(50)  NOT NULL
                   CHECK (event_type IN ('release', 'active_support_end', 'security_support_end', 'eol')),
  event_date       date         NOT NULL,
  source_url       text         NOT NULL CHECK (source_url ~* '^https?://'),
  source_title     text,
  checked_at       timestamptz  NOT NULL,
  recorded_by      varchar(255) NOT NULL,
  notes            text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (release_cycle_id, event_type)
);
CREATE TRIGGER software_lifecycle_events_updated_at BEFORE UPDATE ON software_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. compute_assets
-- ---------------------------------------------------------------------------
CREATE TABLE compute_assets (
  resource_id            uuid         PRIMARY KEY,
  resource_type          varchar(32)  NOT NULL DEFAULT 'compute' CHECK (resource_type = 'compute'),
  asset_kind             varchar(32)  NOT NULL
                         CHECK (asset_kind IN ('vps', 'vm', 'ec2', 'baremetal', 'container_host')),
  hostname               varchar(255),
  display_alias          varchar(255),
  provider               varchar(100),
  region                 varchar(100),
  os_name                varchar(100),
  os_version             varchar(100),
  os_software_product_id uuid         REFERENCES software_products (id),
  os_release_cycle_id    uuid         REFERENCES software_release_cycles (id),
  architecture           varchar(32),
  public_ip              inet,
  private_ip             inet,
  attributes             jsonb        NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (resource_id, resource_type) REFERENCES resources (id, resource_type),
  FOREIGN KEY (os_release_cycle_id, os_software_product_id)
    REFERENCES software_release_cycles (id, software_product_id),
  CHECK (os_release_cycle_id IS NULL OR os_software_product_id IS NOT NULL),
  CHECK (jsonb_typeof(attributes) = 'object')
);
CREATE INDEX compute_assets_hostname_idx ON compute_assets (hostname);
CREATE INDEX compute_assets_os_cycle_idx ON compute_assets (os_release_cycle_id);

-- ---------------------------------------------------------------------------
-- 3. applications
-- ---------------------------------------------------------------------------
CREATE TABLE applications (
  resource_id         uuid         PRIMARY KEY,
  resource_type       varchar(32)  NOT NULL DEFAULT 'application' CHECK (resource_type = 'application'),
  framework           varchar(100),
  framework_version   varchar(100),
  runtime             varchar(100),
  runtime_requirement varchar(100),
  build_tool          varchar(100),
  attributes          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (resource_id, resource_type) REFERENCES resources (id, resource_type),
  CHECK (jsonb_typeof(attributes) = 'object')
);

-- ---------------------------------------------------------------------------
-- 4. service_instances
-- ---------------------------------------------------------------------------
CREATE TABLE service_instances (
  resource_id         uuid         PRIMARY KEY,
  resource_type       varchar(32)  NOT NULL DEFAULT 'service_instance' CHECK (resource_type = 'service_instance'),
  service_kind        varchar(32)  NOT NULL
                      CHECK (service_kind IN ('database', 'cache', 'queue', 'storage', 'hosting', 'other')),
  engine              varchar(100),
  engine_version      varchar(100),
  software_product_id uuid         REFERENCES software_products (id),
  release_cycle_id    uuid         REFERENCES software_release_cycles (id),
  provider            varchar(100),
  is_managed          boolean      NOT NULL DEFAULT false,
  host_compute_id     uuid         REFERENCES compute_assets (resource_id),
  endpoint            text,
  attributes          jsonb        NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (resource_id, resource_type) REFERENCES resources (id, resource_type),
  FOREIGN KEY (release_cycle_id, software_product_id)
    REFERENCES software_release_cycles (id, software_product_id),
  CHECK (release_cycle_id IS NULL OR software_product_id IS NOT NULL),
  CHECK (host_compute_id IS NULL OR host_compute_id <> resource_id),
  CHECK (jsonb_typeof(attributes) = 'object')
);
CREATE INDEX service_instances_host_idx ON service_instances (host_compute_id);
CREATE INDEX service_instances_kind_engine_idx ON service_instances (service_kind, engine);
CREATE INDEX service_instances_cycle_idx ON service_instances (release_cycle_id);

-- ---------------------------------------------------------------------------
-- 5. repositories
-- ---------------------------------------------------------------------------
CREATE TABLE repositories (
  resource_id    uuid         PRIMARY KEY,
  resource_type  varchar(32)  NOT NULL DEFAULT 'repository' CHECK (resource_type = 'repository'),
  provider       varchar(50),
  repository_url text         NOT NULL UNIQUE,
  default_branch varchar(255),
  FOREIGN KEY (resource_id, resource_type) REFERENCES resources (id, resource_type)
);

-- ---------------------------------------------------------------------------
-- 6. application_repositories
-- ---------------------------------------------------------------------------
CREATE TABLE application_repositories (
  id             uuid        PRIMARY KEY DEFAULT uuidv7(),
  application_id uuid        NOT NULL REFERENCES applications (resource_id),
  repository_id  uuid        NOT NULL REFERENCES repositories (resource_id),
  purpose        varchar(32) NOT NULL DEFAULT 'source'
                 CHECK (purpose IN ('source', 'config', 'infra', 'other')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, repository_id, purpose)
);
CREATE INDEX application_repositories_repo_idx ON application_repositories (repository_id);

-- ---------------------------------------------------------------------------
-- 7. deployments
-- ---------------------------------------------------------------------------
CREATE TABLE deployments (
  id                 uuid         PRIMARY KEY DEFAULT uuidv7(),
  application_id     uuid         NOT NULL REFERENCES applications (resource_id),
  target_resource_id uuid         NOT NULL REFERENCES resources (id),
  repository_id      uuid         REFERENCES repositories (resource_id),
  environment        varchar(32)  NOT NULL,
  deploy_path        text,
  deploy_method      varchar(100),
  revision           varchar(255),
  status             varchar(32)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  deployed_at        timestamptz,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CHECK (application_id <> target_resource_id)
);
CREATE TRIGGER deployments_updated_at BEFORE UPDATE ON deployments
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();
CREATE INDEX deployments_app_env_idx ON deployments (application_id, environment);
CREATE INDEX deployments_target_idx ON deployments (target_resource_id);
CREATE INDEX deployments_repo_idx ON deployments (repository_id);

-- ---------------------------------------------------------------------------
-- 9. software_installations
-- ---------------------------------------------------------------------------
CREATE TABLE software_installations (
  id                  uuid         PRIMARY KEY DEFAULT uuidv7(),
  compute_asset_id    uuid         NOT NULL REFERENCES compute_assets (resource_id),
  software_product_id uuid         NOT NULL REFERENCES software_products (id),
  version             varchar(255),
  release_cycle_id    uuid         REFERENCES software_release_cycles (id),
  install_method      varchar(100),
  install_path        text,
  config_path         text,
  last_verified_at    timestamptz,
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now(),
  FOREIGN KEY (release_cycle_id, software_product_id)
    REFERENCES software_release_cycles (id, software_product_id)
);
CREATE TRIGGER software_installations_updated_at BEFORE UPDATE ON software_installations
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();
CREATE INDEX software_installations_compute_idx ON software_installations (compute_asset_id);
CREATE INDEX software_installations_product_version_idx ON software_installations (software_product_id, version);
CREATE INDEX software_installations_cycle_idx ON software_installations (release_cycle_id);

-- ---------------------------------------------------------------------------
-- 10. relation_types
-- ---------------------------------------------------------------------------
CREATE TABLE relation_types (
  code        varchar(50)  PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label       varchar(100) NOT NULL,
  description text,
  is_directed boolean      NOT NULL DEFAULT true,
  is_active   boolean      NOT NULL DEFAULT true,
  -- 専用テーブルから導出する種別は登録させない
  CHECK (code NOT IN ('hosted_on', 'deployed_on', 'managed_by', 'installed_on', 'sourced_from'))
);

INSERT INTO relation_types (code, label, description) VALUES
  ('depends_on',    '依存',     'source が target に論理的に依存する'),
  ('connects_to',   '接続',     'source が target へ通信接続する'),
  ('uses',          '利用',     'source が target を利用する（例: BFF → Redis）'),
  ('publishes_to',  '発行',     'source が target へメッセージを発行する（例: API → SQS）'),
  ('consumes_from', '購読',     'source が target からメッセージを受信する（例: Worker → SQS）');

-- ---------------------------------------------------------------------------
-- 11. resource_relations
-- ---------------------------------------------------------------------------
CREATE TABLE resource_relations (
  id                 uuid        PRIMARY KEY DEFAULT uuidv7(),
  source_resource_id uuid        NOT NULL REFERENCES resources (id),
  target_resource_id uuid        NOT NULL REFERENCES resources (id),
  relation_type      varchar(50) NOT NULL REFERENCES relation_types (code),
  description        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (source_resource_id <> target_resource_id),
  UNIQUE (source_resource_id, target_resource_id, relation_type)
);
CREATE TRIGGER resource_relations_updated_at BEFORE UPDATE ON resource_relations
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();
CREATE INDEX resource_relations_target_idx ON resource_relations (target_resource_id);

-- ---------------------------------------------------------------------------
-- 12-14. diagrams
-- ---------------------------------------------------------------------------
CREATE TABLE diagrams (
  id          uuid         PRIMARY KEY DEFAULT uuidv7(),
  name        varchar(255) NOT NULL,
  description text,
  viewport    jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE TRIGGER diagrams_updated_at BEFORE UPDATE ON diagrams
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();

CREATE TABLE diagram_nodes (
  id              uuid             PRIMARY KEY DEFAULT uuidv7(),
  diagram_id      uuid             NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  resource_id     uuid             NOT NULL REFERENCES resources (id),
  position_x      double precision NOT NULL,
  position_y      double precision NOT NULL,
  display_options jsonb            NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (diagram_id, resource_id)
);
CREATE INDEX diagram_nodes_resource_idx ON diagram_nodes (resource_id);

CREATE TABLE diagram_hidden_edges (
  diagram_id     uuid        NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  edge_kind      varchar(32) NOT NULL
                 CHECK (edge_kind IN ('relation', 'deployment', 'hosting', 'app_repository')),
  edge_record_id uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, edge_kind, edge_record_id)
);
CREATE INDEX diagram_hidden_edges_record_idx ON diagram_hidden_edges (edge_kind, edge_record_id);

-- ---------------------------------------------------------------------------
-- 15. audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          uuid         PRIMARY KEY DEFAULT uuidv7(),
  actor_id    varchar(255) NOT NULL,
  action      varchar(50)  NOT NULL,
  entity_type varchar(100) NOT NULL,
  entity_id   uuid         NOT NULL,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
