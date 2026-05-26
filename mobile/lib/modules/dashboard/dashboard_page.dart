import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('儀表板')),
      body: const Center(
        child: Text('儀表板 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
