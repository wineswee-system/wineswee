import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class AnalyticsPage extends StatelessWidget {
  const AnalyticsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('數據分析')),
      body: const Center(
        child: Text('數據分析 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
