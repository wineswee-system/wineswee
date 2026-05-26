import 'dart:io';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

part 'app_database.g.dart';

// Mirrors approval_requests table
class CachedApprovals extends Table {
  IntColumn get id => integer()();
  TextColumn get module => text()();
  TextColumn get documentType => text()();
  IntColumn get documentId => integer()();
  TextColumn get requester => text()();
  TextColumn get approver => text().nullable()();
  TextColumn get status => text().withDefault(const Constant('待審核'))();
  TextColumn get comments => text().nullable()();
  IntColumn get tenantId => integer().nullable()();
  DateTimeColumn get createdAt => dateTime()();
  DateTimeColumn get syncedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

// Mirrors kpi_data table
class KpiSnapshots extends Table {
  TextColumn get metric => text()();
  RealColumn get value => real().nullable()();
  RealColumn get target => real().nullable()();
  TextColumn get unit => text().nullable()();
  TextColumn get trend => text().withDefault(const Constant('stable'))();
  DateTimeColumn get syncedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {metric};
}

// Mirrors skus table for POS barcode lookup
class PosProducts extends Table {
  IntColumn get id => integer()();
  TextColumn get code => text()();
  TextColumn get name => text()();
  TextColumn get barcode => text().nullable()();
  TextColumn get unit => text().withDefault(const Constant('件'))();
  RealColumn get unitCost => real().withDefault(const Constant(0))();
  RealColumn get stockQty => real().withDefault(const Constant(0))();
  DateTimeColumn get syncedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {id};
}

// Offline queue for approval actions taken without connectivity
class PendingLocalActions extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get type => text()(); // 'approve' | 'reject'
  IntColumn get approvalId => integer()();
  TextColumn get comment => text().nullable()();
  DateTimeColumn get queuedAt => dateTime()();
}

@DriftDatabase(
  tables: [CachedApprovals, KpiSnapshots, PosProducts, PendingLocalActions],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'sme_ops.db'));
    return NativeDatabase.createInBackground(file);
  });
}

final dbProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});
