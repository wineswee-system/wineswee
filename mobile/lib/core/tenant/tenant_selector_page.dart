import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../auth/auth_provider.dart';
import '../theme/app_theme.dart';
import 'tenant_provider.dart';

final _storesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final supabase = ref.watch(supabaseProvider);
  final rows = await supabase
      .from('stores')
      .select('id, name, address, status')
      .eq('status', '營運中')
      .order('name');
  return (rows as List).cast<Map<String, dynamic>>();
});

class TenantSelectorPage extends ConsumerWidget {
  const TenantSelectorPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final storesAsync = ref.watch(_storesProvider);

    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(
        title: const Text('選擇門市'),
        actions: [
          TextButton(
            onPressed: () => Supabase.instance.client.auth.signOut(),
            child: const Text('登出', style: TextStyle(color: AppColors.accentRed)),
          ),
        ],
      ),
      body: storesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: AppColors.accentRed, size: 48),
              const SizedBox(height: 12),
              const Text('載入失敗', style: TextStyle(color: AppColors.textPrimary)),
              const SizedBox(height: 4),
              Text('$e', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () => ref.invalidate(_storesProvider),
                child: const Text('重試'),
              ),
            ],
          ),
        ),
        data: (stores) => stores.isEmpty
            ? const Center(
                child: Text('找不到可用的門市',
                    style: TextStyle(color: AppColors.textSecondary)),
              )
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: stores.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final store = stores[i];
                  return Card(
                    child: ListTile(
                      leading: const Icon(Icons.storefront_outlined,
                          color: AppColors.accentCyan),
                      title: Text(
                        store['name'] as String,
                        style: const TextStyle(color: AppColors.textPrimary),
                      ),
                      subtitle: store['address'] != null
                          ? Text(
                              store['address'] as String,
                              style: const TextStyle(
                                  color: AppColors.textSecondary, fontSize: 12),
                            )
                          : null,
                      trailing: const Icon(Icons.chevron_right,
                          color: AppColors.textMuted),
                      onTap: () async {
                        await ref.read(tenantProvider.notifier).setTenant(
                              store['id'].toString(),
                              store['name'] as String,
                            );
                        if (context.mounted) context.go('/');
                      },
                    ),
                  );
                },
              ),
      ),
    );
  }
}
