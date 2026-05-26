import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final connectivityProvider = StreamProvider<List<ConnectivityResult>>((ref) {
  return Connectivity().onConnectivityChanged;
});

final isOnlineProvider = Provider<bool>((ref) {
  final result = ref.watch(connectivityProvider).valueOrNull;
  // Assume online until the first result arrives
  if (result == null) return true;
  return result.any((r) => r != ConnectivityResult.none);
});
