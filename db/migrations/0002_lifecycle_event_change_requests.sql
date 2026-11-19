-- 18. lifecycle_event_change_requests
-- 既存EOL日付の変更を「承認済み操作」に限定するための承認待ちキュー（設計 §12.2-5 の運用化）。
-- mikke:eol:approve を持たない主体（Agent等）が日付変更を要求すると pending として保存し、
-- 承認者が approve / reject する。承認時は提案時点の updated_at と一致することを確認する（楽観ロック）。

CREATE TABLE lifecycle_event_change_requests (
  id                 uuid         PRIMARY KEY DEFAULT uuidv7(),
  lifecycle_event_id uuid         NOT NULL REFERENCES software_lifecycle_events (id),
  base_updated_at    timestamptz  NOT NULL,
  before_data        jsonb        NOT NULL,
  proposed_data      jsonb        NOT NULL,
  status             varchar(16)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  requested_by       varchar(255) NOT NULL,
  request_note       text,
  decided_by         varchar(255),
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(proposed_data) = 'object' AND jsonb_typeof(before_data) = 'object'),
  -- 決裁済みなら決裁者・日時が必須。pending なら空
  CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  -- 職務分離: 依頼者が自分で承認・却下しない
  CHECK (decided_by IS NULL OR status = 'superseded' OR decided_by <> requested_by)
);
CREATE TRIGGER lifecycle_event_change_requests_updated_at BEFORE UPDATE ON lifecycle_event_change_requests
  FOR EACH ROW EXECUTE FUNCTION mikke_set_updated_at();
-- 1イベントにつき pending は1件。新しい提案が来たら旧提案は superseded にする
CREATE UNIQUE INDEX lifecycle_event_change_requests_pending_uq
  ON lifecycle_event_change_requests (lifecycle_event_id) WHERE status = 'pending';
CREATE INDEX lifecycle_event_change_requests_status_idx
  ON lifecycle_event_change_requests (status, created_at DESC);
