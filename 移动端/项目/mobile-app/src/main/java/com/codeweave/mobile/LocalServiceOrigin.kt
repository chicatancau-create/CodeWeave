package com.codeweave.mobile

import java.net.URI

internal object LocalServiceOrigin {
    fun origin(value: String): String {
        val uri = URI(value.trim())
        require(uri.scheme == "http" && uri.host == "10.0.2.2" && uri.port in 1..65535 &&
            uri.userInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path in listOf("", "/")) {
            "模拟器地址须为 http://10.0.2.2:端口"
        }
        return "http://${uri.host}:${uri.port}"
    }
}
