import 'package:flutter/material.dart';

// Token mapping mirrors src/index.css CSS variables
class AppColors {
  static const bgPrimary   = Color(0xFF0F1117);
  static const bgSecondary = Color(0xFF1A1D27);
  static const bgCard      = Color(0xFF1E2130);
  static const borderColor = Color(0xFF2A2D3E);

  static const textPrimary   = Color(0xFFE8EAF0);
  static const textSecondary = Color(0xFF9AA0B8);
  static const textMuted     = Color(0xFF5C6380);

  static const accentCyan   = Color(0xFF00BCD4);
  static const accentGreen  = Color(0xFF4CAF50);
  static const accentOrange = Color(0xFFFF9800);
  static const accentRed    = Color(0xFFF44336);
  static const accentBlue   = Color(0xFF2196F3);
  static const accentPurple = Color(0xFF9C27B0);

  static const accentCyanDim   = Color(0x1A00BCD4);
  static const accentGreenDim  = Color(0x1A4CAF50);
  static const accentOrangeDim = Color(0x1AFF9800);
  static const accentRedDim    = Color(0x1AF44336);
}

class AppTheme {
  static ThemeData dark() {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AppColors.bgPrimary,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.accentCyan,
        secondary: AppColors.accentPurple,
        error: AppColors.accentRed,
        surface: AppColors.bgCard,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.bgSecondary,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.bgSecondary,
        indicatorColor: AppColors.accentCyanDim,
        labelTextStyle: WidgetStateProperty.all(
          const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        ),
      ),
      cardTheme: const CardThemeData(
        color: AppColors.bgCard,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
          side: BorderSide(color: AppColors.borderColor),
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        filled: true,
        fillColor: AppColors.bgSecondary,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(8)),
          borderSide: BorderSide(color: AppColors.borderColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(8)),
          borderSide: BorderSide(color: AppColors.borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.all(Radius.circular(8)),
          borderSide: BorderSide(color: AppColors.accentCyan),
        ),
        labelStyle: TextStyle(color: AppColors.textSecondary),
        hintStyle: TextStyle(color: AppColors.textMuted),
      ),
      textTheme: const TextTheme(
        bodyLarge:  TextStyle(color: AppColors.textPrimary),
        bodyMedium: TextStyle(color: AppColors.textSecondary),
        bodySmall:  TextStyle(color: AppColors.textMuted),
        titleLarge: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
        titleMedium: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w500),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.accentCyan,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
        ),
      ),
    );
  }
}
