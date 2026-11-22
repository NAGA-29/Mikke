-- 図ごとの線の見た目の上書き（表示設定のみ。正本の関係は変更しない）。
-- 未設定の線は、関係の種類から導出した既定の見た目で描く。
CREATE TABLE diagram_edge_styles (
  diagram_id     uuid        NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  edge_kind      varchar(32) NOT NULL
                 CHECK (edge_kind IN ('relation', 'deployment', 'hosting', 'app_repository')),
  edge_record_id uuid        NOT NULL,
  line_style     varchar(16) NOT NULL CHECK (line_style IN ('solid', 'dashed', 'dotted', 'wavy')),
  arrow_style    varchar(16) NOT NULL CHECK (arrow_style IN ('closed', 'open', 'none')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, edge_kind, edge_record_id)
);
CREATE INDEX diagram_edge_styles_record_idx ON diagram_edge_styles (edge_kind, edge_record_id);
CREATE TRIGGER diagram_edge_styles_updated_at BEFORE UPDATE ON diagram_edge_styles
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();
