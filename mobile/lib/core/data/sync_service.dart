import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../auth/auth_provider.dart';
import '../tenant/tenant_provider.dart';
import 'app_database.dart';

class SyncService {
  final AppDatabase _db;
  final SupabaseClient _supabase;
  final String? _tenantId;

  SyncService(this._db, this._supabase, this._tenantId);

  Future<void> syncAll() async {
    await Future.wait([
      syncApprovals(),
      syncKpi(),
      syncProducts(),
    ]);
    await flushPendingActions();
  }

  Future<void> syncApprovals() async {
    final tenantIdInt = int.tryParse(_tenantId ?? '');
    if (tenantIdInt == null) return;

    final rows = await _supabase
        .from('approval_requests')
        .select()
        .eq('tenant_id', tenantIdInt)
        .eq('status', '待審核')
        .order('created_at', ascending: false)
        .limit(100);

    await _db.transaction(() async {
      await _db.delete(_db.cachedApprovals).go();
      for (final r in rows as List) {
        await _db.into(_db.cachedApprovals).insertOnConflictUpdate(
          CachedApprovalsCompanion.insert(
            id: Value(r['id'] as int),
            module: r['module'] as String,
            documentType: r['document_type'] as String,
            documentId: r['document_id'] as int,
            requester: r['requester'] as String,
            approver: Value(r['approver'] as String?),
            status: Value(r['status'] as String? ?? '待審核'),
            comments: Value(r['comments'] as String?),
            tenantId: Value(r['tenant_id'] as int?),
            createdAt: DateTime.parse(r['created_at'] as String),
            syncedAt: DateTime.now(),
          ),
        );
      }
    });
  }

  Future<void> syncKpi() async {
    final rows = await _supabase.from('kpi_data').select();

    await _db.transaction(() async {
      await _db.delete(_db.kpiSnapshots).go();
      for (final r in rows as List) {
        await _db.into(_db.kpiSnapshots).insertOnConflictUpdate(
          KpiSnapshotsCompanion.insert(
            metric: r['metric'] as String,
            value: Value((r['value'] as num?)?.toDouble()),
            target: Value((r['target'] as num?)?.toDouble()),
            unit: Value(r['unit'] as String?),
            trend: Value(r['trend'] as String? ?? 'stable'),
            syncedAt: DateTime.now(),
          ),
        );
      }
    });
  }

  Future<void> syncProducts() async {
    final rows = await _supabase
        .from('skus')
        .select('id, code, name, barcode, unit, unit_cost, stock_qty')
        .eq('status', '啟用')
        .limit(500);

    await _db.transaction(() async {
      await _db.delete(_db.posProducts).go();
      for (final r in rows as List) {
        await _db.into(_db.posProducts).insertOnConflictUpdate(
          PosProductsCompanion.insert(
            id: Value(r['id'] as int),
            code: r['code'] as String,
            name: r['name'] as String,
            barcode: Value(r['barcode'] as String?),
            unit: Value(r['unit'] as String? ?? '件'),
            unitCost: Value((r['unit_cost'] as num?)?.toDouble() ?? 0),
            stockQty: Value((r['stock_qty'] as num?)?.toDouble() ?? 0),
            syncedAt: DateTime.now(),
          ),
        );
      }
    });
  }

  // Flush offline approval actions queued while disconnected
  Future<void> flushPendingActions() async {
    final actions = await _db.select(_db.pendingLocalActions).get();
    for (final action in actions) {
      try {
        await _supabase.from('approval_requests').update({
          'status': action.type == 'approve' ? '已核准' : '已退回',
          'comments': action.comment,
          'decided_at': DateTime.now().toIso8601String(),
        }).eq('id', action.approvalId);

        await (_db.delete(_db.pendingLocalActions)
              ..where((t) => t.id.equals(action.id)))
            .go();
      } catch (_) {
        // Leave in queue; will retry on next sync
      }
    }
  }
}

final syncServiceProvider = Provider<SyncService>((ref) {
  final db = ref.watch(dbProvider);
  final supabase = ref.watch(supabaseProvider);
  final tenant = ref.watch(tenantProvider);
  return SyncService(db, supabase, tenant.tenantId);
});
