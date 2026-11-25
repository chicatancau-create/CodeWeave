package com.codeweave.mobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class LocalSession(val origin: String, val cookie: String, val accountId: String)
internal data class Response(val body: ByteArray, val sessionCookie: String?, val bundle: String?, val etag: String?)
internal class ServiceError(val code: String, message: String) : Exception(message)

internal class UnifiedService(context: Context) {
    private val prefs = context.getSharedPreferences("codeweave-unified", Context.MODE_PRIVATE)
    private val sessionAlias = "CodeWeave unified local session"
    private val cache = context.getDir("unified-content", Context.MODE_PRIVATE)

    fun origin(value: String): String = LocalServiceOrigin.origin(value)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(sessionAlias, null)
        if (existing is SecretKey) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(sessionAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    fun storedSession(): LocalSession? = runCatching {
        val stored = prefs.getString("session", null) ?: return null
        val encrypted = Base64.decode(stored, Base64.NO_WRAP)
        require(encrypted.size > 12)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, encrypted.copyOfRange(0, 12)))
        val json = JSONObject(cipher.doFinal(encrypted.copyOfRange(12, encrypted.size)).decodeToString())
        LocalSession(origin(json.getString("origin")), json.getString("cookie"), json.getString("accountId"))
    }.getOrNull()

    fun save(session: LocalSession) {
        val json = JSONObject().put("origin", session.origin).put("cookie", session.cookie).put("accountId", session.accountId)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.iv + cipher.doFinal(json.toString().encodeToByteArray())
        check(prefs.edit().putString("session", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
    }

    fun discard(session: LocalSession?) {
        prefs.edit().remove("session").apply()
        if (session != null) {
            val prefix = cachePrefix(session)
            cache.listFiles()?.filter { it.name.startsWith(prefix) }?.forEach { it.delete() }
        }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun cachePrefix(session: LocalSession): String = sha256("${session.origin}\u0000${session.accountId}".encodeToByteArray()) + "-"
    private fun cacheFile(session: LocalSession, identity: String) = cache.resolve(cachePrefix(session) + sha256(identity.encodeToByteArray()))
    fun readCache(session: LocalSession, identity: String): ByteArray? = runCatching { cacheFile(session, identity).readBytes() }.getOrNull()
    fun saveCache(session: LocalSession, identity: String, bytes: ByteArray) {
        val file = cacheFile(session, identity)
        val staged = kotlin.io.path.createTempFile(cache.toPath(), "download-").toFile()
        try {
            staged.writeBytes(bytes)
            check(staged.renameTo(file)) { "无法保存离线副本" }
        } finally {
            staged.delete()
        }
    }
    fun assetValid(bytes: ByteArray, hash: String): Boolean = sha256(bytes) == hash
    fun encoded(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    fun request(host: String, path: String, session: LocalSession? = null, post: JSONObject? = null): Response {
        require(path.startsWith("/api/") && !path.contains('\\'))
        val connection = URI(origin(host) + path).toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 4_000
        connection.readTimeout = 7_000
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        if (session != null) {
            require(session.origin == origin(host))
            connection.setRequestProperty("Cookie", session.cookie)
        }
        try {
            if (post != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(post.toString().encodeToByteArray()) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    check(output.size() + count <= 8 * 1024 * 1024) { "响应超过大小上限" }
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            if (status !in 200..299) {
                val error = runCatching { JSONObject(bytes.decodeToString()) }.getOrNull()
                throw ServiceError(error?.optString("code") ?: "http_$status", error?.optString("error") ?: "服务响应 $status")
            }
            return Response(bytes, connection.getHeaderField("Set-Cookie")?.substringBefore(';'),
                connection.getHeaderField("X-Content-Bundle"), connection.getHeaderField("ETag"))
        } finally {
            connection.disconnect()
        }
    }

    fun data(response: Response): JSONObject = JSONObject(response.body.decodeToString()).getJSONObject("data")

    fun login(host: String, identifier: String, password: String): LocalSession {
        val server = origin(host)
        request(server, "/api/health")
        val response = request(server, "/api/auth/login", post = JSONObject().put("identifier", identifier.trim()).put("password", password))
        val cookie = response.sessionCookie ?: throw ServiceError("session_missing", "服务未返回会话")
        return LocalSession(server, cookie, data(response).getString("id"))
    }
}
