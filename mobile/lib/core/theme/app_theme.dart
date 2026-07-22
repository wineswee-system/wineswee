import 'package:flutter/material.dart';

// Token values mirror src/index.css EXACTLY (web ERP design system).
// Light is the default (matches [data-theme="light"]); dark() mirrors the
// web :root defaults for parity. Semantic accent mapping is fixed — see
// CLAUDE.md "Color & Theme Rules": success=green, warning=orange,
// error=red, info=blue, primary/CTA=cyan, highlight=purple.
class AppColors {
  // ---- LIGHT (web [data-theme="light"]) — mobile default ----
  static const bgPrimary   = Color(0xFFF4F7FC); // --bg-primary
  static const bgSecondary = Color(0xFFEEF2F9); // --bg-secondary
  static const bgTertiary  = Color(0xFFE6EBF4); // --bg-tertiary
  static const bgCard      = Color(0xFFFFFFFF); // --bg-card (0.92 → solid)

  static const textPrimary   = Color(0xFF0F172A); // --text-primary
  static const textSecondary = Color(0xFF334155); // --text-secondary
  static const textTertiary  = Color(0xFF475569); // --text-tertiary
  static const textMuted     = Color(0xFF64748B); // --text-muted

  static const borderSubtle = Color(0x2694A3B8); // rgba(148,163,184,0.15)
  static const borderMedium = Color(0x3894A3B8); // rgba(148,163,184,0.22)
  static const borderColor  = borderMedium;      // default border

  static const accentCyan   = Color(0xFF0E7490); // --accent-cyan (light)
  static const accentBlue   = Color(0xFF3B82F6); // --accent-blue
  static const accentPurple = Color(0xFF8B5CF6); // --accent-purple
  static const accentGreen  = Color(0xFF10B981); // --accent-green
  static const accentOrange = Color(0xFFF59E0B); // --accent-orange
  static const accentRed    = Color(0xFFEF4444); // --accent-red
  static const accentPink   = Color(0xFFEC4899); // --accent-pink
  static const accentYellow = Color(0xFFEAB308); // --accent-yellow

  // -dim variants (light uses ~0.10 alpha per src/index.css)
  static const accentCyanDim   = Color(0x1A0E7490);
  static const accentGreenDim  = Color(0x1A10B981);
  static const accentOrangeDim = Color(0x1AF59E0B);
  static const accentRedDim    = Color(0x1AEF4444);
  static const accentBlueDim   = Color(0x1A3B82F6);
  static const accentPurpleDim = Color(0x1A8B5CF6);

  // Inverse text on accent backgrounds (the one allowed literal, per rule 6)
  static const onAccent = Color(0xFFFFFFFF);
}

// ---- DARK (web :root defaults) — kept for parity/toggle ----
class AppColorsDark {
  static const bgPrimary   = Color(0xFF06091A); // --bg-primary
  static const bgSecondary = Color(0xFF0C1029); // --bg-secondary
  static const bgTertiary  = Color(0xFF111638); // --bg-tertiary
  static const bgCard      = Color(0xFF0F1737); // --bg-card (rgba 0.65 → solid)

  static const textPrimary   = Color(0xFFF1F5F9);
  static const textSecondary = Color(0xFF94A3B8);
  static const textTertiary  = Color(0xFF64748B);
  static const textMuted     = Color(0xFF475569);

  static const borderColor = Color(0x1F94A3B8); // rgba(148,163,184,0.12)

  static const accentCyan   = Color(0xFF22D3EE);
  static const accentBlue   = Color(0xFF3B82F6);
  static const accentPurple = Color(0xFFA78BFA);
  static const accentGreen  = Color(0xFF34D399);
  static const accentOrange = Color(0xFFFB923C);
  static const accentRed    = Color(0xFFF87171);
  static const accentYellow = Color(0xFFFBBF24);

  static const accentCyanDim = Color(0x2622D3EE); // 0.15 alpha
}

class AppTheme {
  static ThemeData light() => _build(
        brightness: Brightness.light,
        bgPrimary: AppColors.bgPrimary,
        surface: AppColors.bgSecondary,
        card: AppColors.bgCard,
        border: AppColors.borderColor,
        primary: AppColors.accentCyan,
        secondary: AppColors.accentPurple,
        error: AppColors.accentRed,
        textPrimary: AppColors.textPrimary,
        textSecondary: AppColors.textSecondary,
        textMuted: AppColors.textMuted,
        indicator: AppColors.accentCyanDim,
        input: AppColors.bgCard,
      );

  static ThemeData dark() => _build(
        brightness: Brightness.dark,
        bgPrimary: AppColorsDark.bgPrimary,
        surface: AppColorsDark.bgSecondary,
        card: AppColorsDark.bgCard,
        border: AppColorsDark.borderColor,
        primary: AppColorsDark.accentCyan,
        secondary: AppColorsDark.accentPurple,
        error: AppColorsDark.accentRed,
        textPrimary: AppColorsDark.textPrimary,
        textSecondary: AppColorsDark.textSecondary,
        textMuted: AppColorsDark.textMuted,
        indicator: AppColorsDark.accentCyanDim,
        input: AppColorsDark.bgSecondary,
      );

  static ThemeData _build({
    required Brightness brightness,
    required Color bgPrimary,
    required Color surface,
    required Color card,
    required Color border,
    required Color primary,
    required Color secondary,
    required Color error,
    required Color textPrimary,
    required Color textSecondary,
    required Color textMuted,
    required Color indicator,
    required Color input,
  }) {
    return ThemeData(
      brightness: brightness,
      scaffoldBackgroundColor: bgPrimary,
      colorScheme: ColorScheme(
        brightness: brightness,
        primary: primary,
        onPrimary: AppColors.onAccent,
        secondary: secondary,
        onSecondary: AppColors.onAccent,
        error: error,
        onError: AppColors.onAccent,
        surface: card,
        onSurface: textPrimary,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: textPrimary,
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: indicator,
        labelTextStyle: WidgetStateProperty.all(
          TextStyle(color: textSecondary, fontSize: 12),
        ),
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.all(Radius.circular(12)),
          side: BorderSide(color: border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: input,
        border: OutlineInputBorder(
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: const BorderRadius.all(Radius.circular(8)),
          borderSide: BorderSide(color: primary),
        ),
        labelStyle: TextStyle(color: textSecondary),
        hintStyle: TextStyle(color: textMuted),
      ),
      textTheme: TextTheme(
        bodyLarge:   TextStyle(color: textPrimary),
        bodyMedium:  TextStyle(color: textSecondary),
        bodySmall:   TextStyle(color: textMuted),
        titleLarge:  TextStyle(color: textPrimary, fontWeight: FontWeight.w600),
        titleMedium: TextStyle(color: textPrimary, fontWeight: FontWeight.w500),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: AppColors.onAccent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 24),
        ),
      ),
    );
  }
}
