import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class HRPage extends StatelessWidget {
  const HRPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('人資管理')),
      body: const Center(
        child: Text('人資管理 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
