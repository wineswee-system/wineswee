import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'auth_provider.dart';

class UserProfile {
  final int? employeeId;
  final String name;
  final String? avatarUrl;
  final String? role;

  const UserProfile({
    this.employeeId,
    required this.name,
    this.avatarUrl,
    this.role,
  });
}

// Fetches the employees row matching the authenticated user's email.
// Joins roles(name) via Supabase foreign-key embed syntax.
final profileProvider = FutureProvider<UserProfile?>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null || user.email == null) return null;

  final supabase = ref.watch(supabaseProvider);
  final rows = await supabase
      .from('employees')
      .select('id, name, avatar, role_id, roles(name)')
      .eq('email', user.email!)
      .limit(1);

  if ((rows as List).isEmpty) return null;
  final r = rows.first as Map<String, dynamic>;
  final roleRow = r['roles'] as Map<String, dynamic>?;

  return UserProfile(
    employeeId: r['id'] as int?,
    name: r['name'] as String,
    avatarUrl: r['avatar'] as String?,
    role: roleRow?['name'] as String?,
  );
});

// Convenience: just the role name string (null if not loaded yet)
final roleProvider = Provider<String?>((ref) {
  return ref.watch(profileProvider).valueOrNull?.role;
});
