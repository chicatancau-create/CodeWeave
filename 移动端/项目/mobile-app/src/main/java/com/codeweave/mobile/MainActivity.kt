package com.codeweave.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.codeweave.mobile.ui.theme.CodeWeaveTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CodeWeaveTheme {
                Scaffold(contentWindowInsets = WindowInsets.safeDrawing) { innerPadding ->
                    Column(
                        modifier = Modifier.fillMaxSize().padding(innerPadding).padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
                        Text(stringResource(R.string.scaffold_ready), style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        }
    }
}
