import { describe, expect, it } from 'vitest';
import { isValidPattern, versionMatches } from '../src/lib/version.js';
import { call, create, ok } from './helpers.js';

const SRC = 'https://www.php.net/supported-versions.php';
const checked = () => new Date().toISOString();

describe('version matching', () => {
  it('matches by prefix at a separator boundary', () => {
    expect(versionMatches('16.4', '16')).toBe(true);
    expect(versionMatches('16', '16')).toBe(true);
    expect(versionMatches('160.1', '16')).toBe(false);
    expect(versionMatches('v22.11.0', '22')).toBe(true);
    expect(versionMatches('8.4.3', '8.4', '8.4.*')).toBe(true);
    expect(versionMatches('1.25.1', '1.x', '1.24, 1.25')).toBe(true);
    expect(versionMatches(null, '16')).toBe(false);
  });
  it('rejects regex-like patterns', () => {
    expect(isValidPattern('^8\\.4.*$')).toBe(false);
    expect(isValidPattern('(a+)+')).toBe(false);
    expect(isValidPattern('8.4, 8.5')).toBe(true);
  });
});

async function phpOnVps(version = '8.4.3') {
  const vps = await create.compute('vps');
  const php = await create.product('PHP', { category: 'runtime' });
  const inst = await ok('POST', '/software/installations', {
    body: { compute_asset_id: vps.id, software_product_id: php.id, version, install_method: 'apt' },
  });
  return { vps, php, inst };
}

describe('release cycles & lifecycle events (MVP受け入れ基準8,9)', () => {
  it('creates a cycle and assigns it to an installation in one transaction, then records EOL with source', async () => {
    const { php, inst } = await phpOnVps();
    const cycle = await ok('POST', '/software/release-cycles', {
      body: {
        software_product_id: php.id,
        cycle: '8.4',
        assign_to: { target_kind: 'installation', target_id: inst.id },
      },
    });
    expect(cycle.assignment.changed).toBe(true);

    const ev = await ok('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: cycle.id, event_type: 'eol', event_date: '2028-12-31', source_url: SRC, checked_at: checked() },
    });
    expect(ev.recorded_by).toBe('test:writer');

    // 同一内容の再登録は冪等
    const again = await call('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: cycle.id, event_type: 'eol', event_date: '2028-12-31', source_url: SRC, checked_at: checked() },
    });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(ev.id);

    // 異なる日付は 409 + 差分
    const diff = await call('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: cycle.id, event_type: 'eol', event_date: '2029-01-31', source_url: SRC, checked_at: checked() },
    });
    expect(diff.status).toBe(409);
    expect(diff.body.error.details.diff.event_date).toEqual({ before: '2028-12-31', after: '2029-01-31' });

    const got = await ok('GET', `/software/release-cycles/${cycle.id}`);
    expect(got.events).toHaveLength(1);
    expect(got.in_service_assignments).toBe(1);
  });

  it('refuses cycles/events that no in-service asset uses (資産起点)', async () => {
    const { php } = await phpOnVps('8.4.3');
    const r = await call('POST', '/software/release-cycles', { body: { software_product_id: php.id, cycle: '7.4' } });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('release_cycle_not_in_use');
    // 稼働中資産のバージョンに一致する系列なら assign_to なしでも作成できる
    await ok('POST', '/software/release-cycles', { body: { software_product_id: php.id, cycle: '8.4' } });

    const unused = await create.product('Perl');
    expect((await call('POST', '/software/release-cycles', { body: { software_product_id: unused.id, cycle: '5.38' } })).status).toBe(422);
  });

  it('rejects assigning a cycle of another product or a mismatching version', async () => {
    const { php, inst } = await phpOnVps('8.3.1');
    const node = await create.product('Node.js');
    const vps2 = await create.compute('vps2');
    const nodeInst = await ok('POST', '/software/installations', { body: { compute_asset_id: vps2.id, software_product_id: node.id, version: '22.1.0' } });
    const nodeCycle = await ok('POST', '/software/release-cycles', { body: { software_product_id: node.id, cycle: '22' } });

    const wrongProduct = await call('PUT', `/software/installations/${inst.id}/release-cycle`, { body: { release_cycle_id: nodeCycle.id } });
    expect(wrongProduct.body.error.code).toBe('product_mismatch');

    const php84 = await ok('POST', '/software/release-cycles', {
      body: { software_product_id: php.id, cycle: '8.4', assign_to: { target_kind: 'installation', target_id: nodeInst.id, allow_version_mismatch: true } },
    }).catch((e) => e);
    expect(String(php84)).toMatch(/product_mismatch/); // 別製品の導入には紐付けられず、系列作成もロールバック
    expect(await ok('GET', `/software/release-cycles?software_product_id=${php.id}`)).toHaveLength(0);
  });

  it('requires optimistic lock and eol:approve to change an existing date', async () => {
    const { php, inst } = await phpOnVps();
    const cycle = await ok('POST', '/software/release-cycles', {
      body: { software_product_id: php.id, cycle: '8.4', assign_to: { target_kind: 'installation', target_id: inst.id } },
    });
    const ev = await ok('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: cycle.id, event_type: 'security_support_end', event_date: '2028-12-31', source_url: SRC, checked_at: checked() },
    });
    const put = (as: 'writer' | 'approver', patch: Record<string, unknown>, expected = ev.updated_at) =>
      call('PUT', `/software/lifecycle-events/${ev.id}`, {
        as,
        body: { event_date: ev.event_date, source_url: SRC, source_title: null, checked_at: checked(), notes: null, expected_updated_at: expected, ...patch },
      });

    // 日付以外（確認日時・注記）の更新は write で可能
    const touched = await put('writer', { notes: 're-checked' });
    expect(touched.status).toBe(200);

    // 古い updated_at では stale_update
    const stale = await put('writer', { notes: 'x' }, ev.updated_at);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_update');

    // 日付変更は承認権限が必要（差分を提示）
    const denied = await put('writer', { event_date: '2029-06-30' }, touched.body.updated_at);
    expect(denied.status).toBe(403);
    expect(denied.body.error.details.diff.event_date.after).toBe('2029-06-30');

    const approved = await put('approver', { event_date: '2029-06-30' }, touched.body.updated_at);
    expect(approved.status).toBe(200);
    expect(approved.body.recorded_by).toBe('test:approver');

    const logs = await ok('GET', `/audit-logs?entity_type=software_lifecycle_event&entity_id=${ev.id}`);
    expect(logs[0].before_data.event_date).toBe('2028-12-31');
    expect(logs[0].after_data.event_date).toBe('2029-06-30');
  });
});

describe('EOL status', () => {
  it('distinguishes eol / approaching / supported / unknown across installations, services and OS', async () => {
    const asOf = '2026-11-19';
    const vps = await create.compute('vps', { os_name: 'Ubuntu', os_version: '22.04.5' });
    const ubuntu = await create.product('Ubuntu', { vendor: 'Canonical', category: 'os' });
    await ok('PATCH', `/resources/${vps.id}`, { body: { detail: { os_software_product_id: ubuntu.id } } });
    const ubuntuCycle = await ok('POST', '/software/release-cycles', {
      body: { software_product_id: ubuntu.id, cycle: '22.04', assign_to: { target_kind: 'compute_os', target_id: vps.id } },
    });
    await ok('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: ubuntuCycle.id, event_type: 'security_support_end', event_date: '2027-01-31', source_url: 'https://ubuntu.com/about/release-cycle', checked_at: checked() },
    });

    const pgProduct = await create.product('PostgreSQL');
    const db = await create.service('postgres-main', { service_kind: 'database', engine: 'PostgreSQL', engine_version: '13.20', software_product_id: pgProduct.id, host_compute_id: vps.id });
    const pg13 = await ok('POST', '/software/release-cycles', {
      body: { software_product_id: pgProduct.id, cycle: '13', assign_to: { target_kind: 'service_instance', target_id: db.id } },
    });
    await ok('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: pg13.id, event_type: 'eol', event_date: '2025-11-13', source_url: 'https://www.postgresql.org/support/versioning/', checked_at: checked() },
    });

    const php = await create.product('PHP');
    const inst = await ok('POST', '/software/installations', { body: { compute_asset_id: vps.id, software_product_id: php.id, version: '8.4.3' } });
    const php84 = await ok('POST', '/software/release-cycles', {
      body: { software_product_id: php.id, cycle: '8.4', assign_to: { target_kind: 'installation', target_id: inst.id } },
    });
    // active_support_end だけでは EOL と断定しない → unknown
    await ok('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: php84.id, event_type: 'active_support_end', event_date: '2026-12-31', source_url: SRC, checked_at: checked() },
    });

    await create.service('redis', { service_kind: 'cache', engine: 'Redis', engine_version: '7.4.2', host_compute_id: vps.id });

    const res = await ok('GET', `/eol/status?as_of=${asOf}`);
    const byName = Object.fromEntries(res.items.map((i: any) => [`${i.target_kind}:${i.product?.name ?? i.resource.name}`, i]));
    expect(byName['compute_os:Ubuntu'].status).toBe('approaching_eol');
    expect(byName['compute_os:Ubuntu'].end_basis).toBe('security_support_end');
    expect(byName['service_instance:PostgreSQL'].status).toBe('eol');
    expect(byName['installation:PHP'].status).toBe('unknown');
    expect(byName['installation:PHP'].reason).toBe('end_date_not_registered');
    expect(byName['service_instance:redis'].reason).toBe('product_not_identified');
    expect(res.summary).toMatchObject({ eol: 1, approaching_eol: 1, unknown: 2, supported: 0 });

    // 鮮度: 確認日時から180日超なら stale
    const later = await ok('GET', `/eol/status?as_of=2027-12-01&status=eol`);
    expect(later.items.every((i: any) => i.stale)).toBe(true);

    // アーカイブ済み資産は集計対象外
    await ok('POST', `/resources/${db.id}/archive`, { as: 'admin' });
    const after = await ok('GET', `/eol/status?as_of=${asOf}`);
    expect(after.summary.eol).toBe(0);
  });

  it('treats disputed cycles as unknown and flags version drift', async () => {
    const { php, inst } = await phpOnVps('8.4.3');
    const cycle = await ok('POST', '/software/release-cycles', {
      body: { software_product_id: php.id, cycle: '8.4', assign_to: { target_kind: 'installation', target_id: inst.id } },
    });
    await ok('POST', '/software/lifecycle-events', {
      body: { release_cycle_id: cycle.id, event_type: 'eol', event_date: '2028-12-31', source_url: SRC, checked_at: checked() },
    });
    await ok('PATCH', `/software/installations/${inst.id}`, { body: { version: '8.5.0' } });
    let s = await ok('GET', '/eol/status?target_kind=installation&as_of=2026-11-19');
    expect(s.items[0].status).toBe('supported');
    expect(s.items[0].cycle_mismatch).toBe(true);

    const cur = await ok('GET', `/software/release-cycles/${cycle.id}`);
    await ok('PUT', `/software/release-cycles/${cycle.id}`, {
      body: { cycle: '8.4', match_pattern: null, verification_status: 'disputed', verified_at: null, verified_by: null, notes: 'conflicting sources', expected_updated_at: cur.updated_at },
    });
    s = await ok('GET', '/eol/status?target_kind=installation&as_of=2026-11-19');
    expect(s.items[0].status).toBe('unknown');
    expect(s.items[0].reason).toBe('release_cycle_disputed');
  });
});
