import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class ApprovalsPage extends StatelessWidget {
  const ApprovalsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('審核中心')),
      body: const Center(
        child: Text('審核中心 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
