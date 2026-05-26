import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class POSPage extends StatelessWidget {
  const POSPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(title: const Text('銷售點')),
      body: const Center(
        child: Text('銷售點 — 開發中', style: TextStyle(color: AppColors.textSecondary)),
      ),
    );
  }
}
