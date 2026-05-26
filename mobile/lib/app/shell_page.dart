import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/tenant/tenant_provider.dart';
import '../core/theme/app_theme.dart';

class ShellPage extends ConsumerWidget {
  final Widget child;
  const ShellPage({super.key, required this.child});

  static const _tabs = [
    (icon: Icons.dashboard_outlined, label: '儀表板', path: '/'),
    (icon: Icons.people_outline, label: '人資', path: '/hr'),
    (icon: Icons.approval_outlined, label: '審核', path: '/approvals'),
    (icon: Icons.point_of_sale, label: 'POS', path: '/pos'),
    (icon: Icons.analytics_outlined, label: '分析', path: '/analytics'),
  ];

  int _selectedIndex(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final idx = _tabs.indexWhere((t) => t.path == location);
    return idx < 0 ? 0 : idx;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final storeName = ref.watch(tenantProvider).storeName;

    return Scaffold(
      appBar: AppBar(
        title: Text(storeName ?? 'SME Ops'),
        actions: [
          IconButton(
            icon: const Icon(Icons.store_outlined, color: AppColors.textSecondary),
            tooltip: '切換門市',
            onPressed: () => ref.read(tenantProvider.notifier).clearTenant(),
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: AppColors.textSecondary),
            tooltip: '登出',
            onPressed: () => Supabase.instance.client.auth.signOut(),
          ),
        ],
      ),
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex(context),
        onDestinationSelected: (i) => context.go(_tabs[i].path),
        destinations: _tabs
            .map((t) => NavigationDestination(
                  icon: Icon(t.icon, color: AppColors.textMuted),
                  selectedIcon: Icon(t.icon, color: AppColors.accentCyan),
                  label: t.label,
                ))
            .toList(),
      ),
    );
  }
}
