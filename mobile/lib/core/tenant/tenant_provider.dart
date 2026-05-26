import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Mirrors TenantContext from src/contexts/TenantContext.jsx
class TenantState {
  final String? tenantId;
  final String? storeName;
  const TenantState({this.tenantId, this.storeName});
}

class TenantNotifier extends StateNotifier<TenantState> {
  TenantNotifier() : super(const TenantState());

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    state = TenantState(
      tenantId: prefs.getString('tenant_id'),
      storeName: prefs.getString('store_name'),
    );
  }

  Future<void> setTenant(String id, String name) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('tenant_id', id);
    await prefs.setString('store_name', name);
    state = TenantState(tenantId: id, storeName: name);
  }

  Future<void> clearTenant() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('tenant_id');
    await prefs.remove('store_name');
    state = const TenantState();
  }
}

final tenantProvider = StateNotifierProvider<TenantNotifier, TenantState>(
  (_) => TenantNotifier(),
);
