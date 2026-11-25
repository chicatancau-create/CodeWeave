package com.codeweave.mobile

import android.graphics.BitmapFactory
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.codeweave.mobile.ui.theme.CodeWeaveTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val service = UnifiedService(applicationContext)
        val requestedOrigin = intent.getStringExtra("codeweaveOrigin")
        val defaultOrigin = requestedOrigin?.let { runCatching { service.origin(it) }.getOrNull() }
            ?: "http://10.0.2.2:4173"
        setContent { CodeWeaveTheme { LearningScreen(service, defaultOrigin) } }
    }
}

@Composable
private fun LearningScreen(service: UnifiedService, defaultOrigin: String) {
    val content = remember(service) { UnifiedContent(service) }
    val scope = rememberCoroutineScope()
    var generation by remember { mutableIntStateOf(0) }
    var session by remember { mutableStateOf<LocalSession?>(null) }
    var address by remember { mutableStateOf(defaultOrigin) }
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var catalog by remember { mutableStateOf<Catalog?>(null) }
    var page by remember { mutableStateOf<CoursePage?>(null) }
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }

    fun loadCourses(active: LocalSession) {
        val token = generation
        busy = true
        scope.launch {
            try {
                val loaded = withContext(Dispatchers.IO) { content.catalog(active) }
                if (token == generation) catalog = loaded
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                if (token == generation) {
                    val expired = (error as? ServiceError)?.code in setOf("unauthorized", "session_scope_changed", "owner_vault_mismatch", "vault_private")
                    if (expired) {
                        withContext(Dispatchers.IO) { service.discard(active) }
                        if (token == generation) { session = null; catalog = null; page = null }
                    }
                    if (token == generation) notice = error.message ?: "无法读取课程目录"
                }
            } finally { if (token == generation) busy = false }
        }
    }

    LaunchedEffect(service) {
        val token = generation
        val saved = withContext(Dispatchers.IO) { service.storedSession() }
        if (saved != null && token == generation) { session = saved; address = saved.origin; loadCourses(saved) }
    }

    Scaffold(contentWindowInsets = WindowInsets.safeDrawing) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("CodeWeave", style = MaterialTheme.typography.headlineMedium)
            if (busy) CircularProgressIndicator()
            notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            val active = session
            if (active == null) {
                OutlinedTextField(address, { address = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    label = { Text("服务地址") }, enabled = !busy)
                OutlinedTextField(identifier, { identifier = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    label = { Text("邮箱或手机号") }, enabled = !busy)
                OutlinedTextField(password, { password = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    label = { Text("密码") }, visualTransformation = PasswordVisualTransformation(), enabled = !busy)
                Button(onClick = {
                    generation += 1
                    val token = generation
                    val host = address
                    val login = identifier
                    val secret = password
                    password = ""
                    busy = true
                    notice = null
                    scope.launch {
                        try {
                            val signedIn = withContext(Dispatchers.IO) { service.login(host, login, secret).also(service::save) }
                            if (token == generation) { session = signedIn; loadCourses(signedIn) }
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (error: Exception) {
                            if (token == generation) { busy = false; notice = error.message ?: "无法登录" }
                        }
                    }
                }, enabled = !busy && identifier.isNotBlank() && password.isNotEmpty()) { Text("登录") }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TextButton(onClick = { page = null; notice = null; loadCourses(active) }, enabled = !busy) { Text("刷新目录") }
                    TextButton(onClick = {
                        generation += 1
                        val token = generation
                        session = null
                        catalog = null
                        page = null
                        busy = true
                        notice = null
                        scope.launch {
                            try {
                                withContext(Dispatchers.IO) {
                                    service.discard(active)
                                    runCatching { service.request(active.origin, "/api/auth/logout", active, JSONObject()) }
                                }
                            } finally { if (token == generation) busy = false }
                        }
                    }) { Text("退出登录") }
                }
                catalog?.let { index ->
                    Text(if (index.offline || page?.offline == true) "离线只读" else "已连接", style = MaterialTheme.typography.titleSmall)
                    Text("实例 ${index.serviceInstance}\n资料库 ${index.vaultId}\n快照 ${index.bundleId}\n校验 ${index.manifestHash}",
                        style = MaterialTheme.typography.bodySmall)
                    val opened = page
                    if (opened == null) {
                        index.courses.forEach { course ->
                            Button(modifier = Modifier.fillMaxWidth(), enabled = !busy, onClick = {
                                val token = generation
                                busy = true
                                notice = null
                                scope.launch {
                                    try {
                                        val loaded = withContext(Dispatchers.IO) { content.page(active, index, course) }
                                        if (token == generation) page = loaded
                                    } catch (cancelled: CancellationException) { throw cancelled }
                                    catch (error: Exception) {
                                        if (token == generation) {
                                            notice = error.message ?: "无法读取课程"
                                            if ((error as? ServiceError)?.code == "unauthorized") loadCourses(active)
                                        }
                                    } finally { if (token == generation) busy = false }
                                }
                            }) { Text(course.title) }
                        }
                    } else {
                        TextButton(onClick = { page = null }) { Text("返回目录") }
                        Text(opened.title, style = MaterialTheme.typography.titleLarge)
                        Text(opened.markdown)
                        opened.exercises.forEach { (title, prompt) ->
                            Text(title, style = MaterialTheme.typography.titleMedium)
                            Text(prompt)
                        }
                        opened.attachments.forEach { attachment ->
                            val bitmap = remember(attachment) { BitmapFactory.decodeByteArray(attachment.bytes, 0, attachment.bytes.size) }
                            if (bitmap == null) Text(attachment.name) else Image(bitmap.asImageBitmap(), attachment.name, Modifier.fillMaxWidth())
                        }
                    }
                }
            }
        }
    }
}
