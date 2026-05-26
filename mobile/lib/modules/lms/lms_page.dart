import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class LMSPage extends StatelessWidget {
  const LMSPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('學習系統')),
      body: const Center(
        child: Text('學習系統 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
