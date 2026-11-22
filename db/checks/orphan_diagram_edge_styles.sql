-- 定期チェック用（読み取り専用）。結果が0行なら孤児なし。
-- hosting はサービス行の存在だけでなく host_compute_id の有無も検査する。
SELECT h.*
FROM diagram_edge_styles h
WHERE (h.edge_kind = 'relation' AND NOT EXISTS (
         SELECT 1 FROM resource_relations r WHERE r.id = h.edge_record_id))
   OR (h.edge_kind = 'deployment' AND NOT EXISTS (
         SELECT 1 FROM deployments d WHERE d.id = h.edge_record_id))
   OR (h.edge_kind = 'hosting' AND NOT EXISTS (
         SELECT 1 FROM service_instances s
         WHERE s.resource_id = h.edge_record_id AND s.host_compute_id IS NOT NULL))
   OR (h.edge_kind = 'app_repository' AND NOT EXISTS (
         SELECT 1 FROM application_repositories a WHERE a.id = h.edge_record_id));
