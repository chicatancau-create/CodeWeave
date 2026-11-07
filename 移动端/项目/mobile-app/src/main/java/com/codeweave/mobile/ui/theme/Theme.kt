package com.codeweave.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Dark roles follow the desktop adapter's final --ds-* tokens; light roles keep the same cyan accent.
private val DarkColors = darkColorScheme(
    primary = Color(0xFF8ED5FF),
    onPrimary = Color(0xFF052536),
    secondary = Color(0xFF6BE9F1),
    background = Color(0xFF0F131B),
    onBackground = Color(0xFFE2E7EF),
    surface = Color(0xFF181D25),
    onSurface = Color(0xFFE2E7EF),
    onSurfaceVariant = Color(0xFFA3AFBE),
    error = Color(0xFFFF8371),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF00658A),
    onPrimary = Color(0xFFFFFFFF),
    secondary = Color(0xFF00696F),
    background = Color(0xFFF7F9FC),
    onBackground = Color(0xFF181D25),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF181D25),
    onSurfaceVariant = Color(0xFF465364),
    error = Color(0xFFB3261E),
)

@Composable
fun CodeWeaveTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
