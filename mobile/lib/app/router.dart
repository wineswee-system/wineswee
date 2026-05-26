import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/auth/auth_provider.dart';
import '../core/tenant/tenant_provider.dart';
import '../core/tenant/tenant_selector_page.dart';
import '../modules/dashboard/dashboard_page.dart';
import '../modules/hr/hr_page.dart';
import '../modules/approvals/approvals_page.dart';
import '../modules/pos/pos_page.dart';
import '../modules/crm/crm_page.dart';
import '../modules/wms/wms_page.dart';
import '../modules/lms/lms_page.dart';
import '../modules/analytics/analytics_page.dart';
import 'shell_page.dart';
import 'login_page.dart';

// Mirrors ROLE_ROUTES from src/App.jsx
final routerProvider = Provider<GoRouter>((ref) {
  final isAuthenticated = ref.watch(isAuthenticatedProvider);
  final tenant = ref.watch(tenantProvider);

  return GoRouter(
    initialLocation: '/',
    redirect: (context, state) {
      final loggedIn = isAuthenticated;
      final onLogin = state.matchedLocation == '/login';
      final onTenantSelect = state.matchedLocation == '/tenant-select';

      if (!loggedIn && !onLogin) return '/login';
      if (loggedIn && onLogin) return '/';
      if (loggedIn && !onTenantSelect && tenant.tenantId == null) {
        return '/tenant-select';
      }
      if (loggedIn && onTenantSelect && tenant.tenantId != null) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (ctx, state) => const LoginPage()),
      GoRoute(
          path: '/tenant-select',
          builder: (ctx, state) => const TenantSelectorPage()),
      ShellRoute(
        builder: (context, state, child) => ShellPage(child: child),
        routes: [
          GoRoute(path: '/',        builder: (ctx, state) => const DashboardPage()),
          GoRoute(path: '/hr',      builder: (ctx, state) => const HRPage()),
          GoRoute(path: '/approvals', builder: (ctx, state) => const ApprovalsPage()),
          GoRoute(path: '/pos',     builder: (ctx, state) => const POSPage()),
          GoRoute(path: '/crm',     builder: (ctx, state) => const CRMPage()),
          GoRoute(path: '/wms',     builder: (ctx, state) => const WMSPage()),
          GoRoute(path: '/lms',     builder: (ctx, state) => const LMSPage()),
          GoRoute(path: '/analytics', builder: (ctx, state) => const AnalyticsPage()),
        ],
      ),
    ],
  );
});
