import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class WMSPage extends StatelessWidget {
  const WMSPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('倉儲管理')),
      body: const Center(
        child: Text('倉儲管理 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
