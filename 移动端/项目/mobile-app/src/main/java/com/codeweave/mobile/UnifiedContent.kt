package com.codeweave.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

internal data class CourseSummary(val id: String, val title: String)
internal data class Catalog(
    val serviceInstance: String,
    val vaultId: String,
    val bundleId: String,
    val manifestHash: String,
    val courses: List<CourseSummary>,
    val offline: Boolean,
) {
    val identity: String get() = "$serviceInstance/$vaultId/$bundleId/$manifestHash"
}
internal data class Attachment(val name: String, val bytes: ByteArray)
internal data class CoursePage(val title: String, val markdown: String, val exercises: List<Pair<String, String>>,
    val attachments: List<Attachment>, val offline: Boolean)

private fun JSONArray.records() = (0 until length()).map { getJSONObject(it) }

internal class UnifiedContent(private val service: UnifiedService) {
    fun catalog(session: LocalSession): Catalog {
        val (json, offline) = try {
            val me = service.data(service.request(session.origin, "/api/auth/me", session))
            if (me.optString("id") != session.accountId) throw ServiceError("session_scope_changed", "账户已切换")
            val response = service.request(session.origin, "/api/content/catalog", session)
            val content = service.data(response)
            parseCatalog(content, false)
            service.saveCache(session, "catalog", response.body)
            content to false
        } catch (error: IOException) {
            val cached = service.readCache(session, "catalog") ?: throw error
            JSONObject(cached.decodeToString()).getJSONObject("data") to true
        }
        return parseCatalog(json, offline)
    }

    private fun parseCatalog(json: JSONObject, offline: Boolean): Catalog {
        if (json.optInt("contractVersion") != 1 || json.optJSONArray("capabilities")?.toString()?.contains("\"pinnedContent\"") != true) {
            throw ServiceError("unsupported_contract", "服务版本不支持固定课程快照")
        }
        return Catalog(json.getString("serviceInstance"), json.getString("vaultId"), json.getString("bundleId"),
            json.getString("manifestHash"), json.getJSONArray("lessons").records().map {
                CourseSummary(it.getString("contentId"), it.getString("title"))
            }, offline)
    }

    fun page(session: LocalSession, catalog: Catalog, summary: CourseSummary): CoursePage {
        val identity = "${catalog.identity}/lesson/${summary.id}"
        val bundle = service.encoded(catalog.bundleId)
        val (json, offline) = try {
            val response = service.request(session.origin, "/api/content/lessons/${service.encoded(summary.id)}?bundleId=$bundle", session)
            if (response.bundle != catalog.bundleId) throw ServiceError("bundle_mismatch", "课程版本与目录不一致")
            val content = service.data(response)
            if (content.getJSONObject("lesson").getString("contentId") != summary.id) throw ServiceError("content_mismatch", "课程标识与目录不一致")
            service.saveCache(session, identity, response.body)
            content to false
        } catch (error: IOException) {
            val cached = service.readCache(session, identity) ?: throw error
            JSONObject(cached.decodeToString()).getJSONObject("data") to true
        }
        val lesson = json.getJSONObject("lesson")
        val attachments = json.optJSONArray("assets")?.records().orEmpty().mapNotNull { asset ->
            val path = asset.getString("path")
            val hash = asset.getString("sha256")
            val key = "${catalog.identity}/attachment/$hash"
            val bytes = if (offline) service.readCache(session, key) else try {
                val response = service.request(session.origin, "/api/content/asset?bundleId=$bundle&path=${service.encoded(path)}", session)
                if (response.bundle != catalog.bundleId || !service.assetValid(response.body, hash)) {
                    throw ServiceError("asset_integrity_failed", "附件校验失败")
                }
                service.saveCache(session, key, response.body)
                response.body
            } catch (_: IOException) { service.readCache(session, key) }
            bytes?.takeIf { service.assetValid(it, hash) }?.let { Attachment(path.substringAfterLast('/'), it) }
        }
        return CoursePage(lesson.getString("title"), lesson.optJSONObject("reading")?.optString("markdown").orEmpty(),
            json.getJSONArray("exercises").records().map { it.getString("title") to it.optString("prompt") }, attachments, offline)
    }
}
