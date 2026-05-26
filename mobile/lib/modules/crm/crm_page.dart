import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class CRMPage extends StatelessWidget {
  const CRMPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('客戶管理')),
      body: const Center(
        child: Text('客戶管理 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
