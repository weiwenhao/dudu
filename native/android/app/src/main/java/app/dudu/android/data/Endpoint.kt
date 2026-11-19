package app.dudu.android.data

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

data class ConnectionAddress(val origin: String, val kind: String) {
    companion object {
        fun parse(value: String, kind: String? = null): ConnectionAddress {
            val uri = URI(value.trim())
            require(uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank())
            require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
            require(uri.path in listOf("", "/") && uri.port in -1..65535 && uri.port != 0)
            require(kind == null || kind in listOf("lan", "public"))
            return ConnectionAddress(URI(uri.scheme, null, uri.host.lowercase(Locale.ROOT),
                uri.port, null, null, null).toString(), kind ?: if (localHost(uri.host)) "lan" else "public")
        }

        fun validate(values: List<ConnectionAddress>): List<ConnectionAddress> {
            require(values.size in 1..32)
            val result = values.map { parse(it.origin, it.kind) }
            require(result.groupBy { it.origin }.values.all { group -> group.map { it.kind }.distinct().size == 1 })
            return result.distinctBy { it.origin }
        }
    }
}

class Endpoint private constructor(
    val origin: String,
    val token: String,
    val computerId: String?,
    val deviceId: String?,
    val name: String,
    val addresses: List<ConnectionAddress>,
) {
    override fun toString() = "Endpoint(computerId=$computerId)"

    fun selecting(address: ConnectionAddress): Endpoint {
        require(address in addresses)
        return Endpoint(address.origin, token, computerId, deviceId, name, addresses)
    }

    fun withAddresses(values: List<ConnectionAddress>): Endpoint {
        require(computerId != null && deviceId != null)
        val routes = ConnectionAddress.validate(values)
        return Endpoint(routes.find { it.origin == origin }?.origin ?: routes.first().origin,
            token, computerId, deviceId, name, routes)
    }

    fun identified(computer: String, device: String?, routes: List<ConnectionAddress>?): Endpoint {
        require(identity.matches(computer) && (device == null || identity.matches(device)))
        val known = routes?.let { values ->
            val current = values.find { it.origin == origin } ?: ConnectionAddress.parse(origin)
            ConnectionAddress.validate(values + current)
        } ?: addresses
        return Endpoint(origin, token, computer, device ?: deviceId, name, known)
    }

    fun storedLink(): String {
        val fields = mutableListOf("pair" to token, "name" to name)
        computerId?.let { fields += "computer" to it }
        deviceId?.let {
            fields += "device" to it
            addresses.forEach { address -> fields += address.kind to address.origin }
        }
        return "$origin/?" + fields.joinToString("&") { (key, value) ->
            "$key=${URLEncoder.encode(value, "UTF-8")}"
        }
    }

    companion object {
        private val identity = Regex("[A-Za-z0-9_-]{1,100}")

        fun parse(value: String): Endpoint {
            require(value.length <= 131072)
            var uri = URI(value.trim())
            if (uri.scheme in listOf("dudu", "harness-mobile")) {
                require(uri.host == "connect")
                val targets = query(uri)["url"]
                require(targets?.size == 1)
                uri = URI(targets.single())
            }
            require(!uri.host.isNullOrEmpty() && uri.rawUserInfo == null && uri.rawFragment == null)
            require(uri.path in listOf("", "/", "/api/remote.mux"))
            val query = query(uri)
            val tokens = query["pair"]
            require(tokens?.size == 1 && tokens.single().matches(Regex("[A-Za-z0-9_-]{43}")))
            fun optionalIdentity(key: String): String? {
                val values = query[key] ?: return null
                require(values.size == 1 && values.single().matches(identity))
                return values.single()
            }
            val computer = optionalIdentity("computer")
            val device = optionalIdentity("device")
            require(device == null || computer != null)
            require(uri.port in -1..65535 && uri.port != 0)
            val scheme = when (uri.scheme?.lowercase(Locale.ROOT)) {
                "https", "wss" -> "https"
                "http" -> "http"
                "ws" -> {
                    require(localHost(uri.host))
                    "http"
                }
                else -> error("Invalid scheme")
            }
            val port = if (localHost(uri.host) && uri.port in listOf(3097, 3107)) 3170 else uri.port
            val origin = URI(scheme, null, uri.host.lowercase(Locale.ROOT), port, null, null, null).toString()
            val alternatives = listOf("lan", "public").flatMap { kind ->
                query[kind].orEmpty().map { ConnectionAddress.parse(it, kind) }
            }
            require(alternatives.isEmpty() || device != null)
            val addresses = ConnectionAddress.validate(alternatives.let {
                if (it.any { route -> route.origin == origin }) it else listOf(ConnectionAddress.parse(origin)) + it
            })
            return Endpoint(origin, tokens.single(), computer, device,
                query["name"]?.firstOrNull()?.trim()?.take(80)?.ifEmpty { null } ?: uri.host, addresses)
        }

        private fun query(uri: URI): Map<String, List<String>> =
            uri.rawQuery?.split("&")?.groupBy(
                { decode(it.substringBefore("=")) },
                { decode(it.substringAfter("=", "")) },
            ) ?: emptyMap()

        private fun decode(value: String) = URLDecoder.decode(value, "UTF-8")

        internal fun localHost(value: String): Boolean {
            val host = value.lowercase(Locale.ROOT).trim('[', ']').trimEnd('.')
            if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
                || host == "::1" || host.startsWith("fe80:") || host.startsWith("fc") && host.contains(":")
                || host.startsWith("fd") && host.contains(":")) return true
            val parts = host.split(".").map { it.toIntOrNull() }
            if (parts.size != 4 || parts.any { it == null || it !in 0..255 }) return false
            val a = parts[0]!!
            val b = parts[1]!!
            return a == 10 || a == 127 || a == 192 && b == 168 || a == 172 && b in 16..31 ||
                a == 169 && b == 254 || a == 100 && b in 64..127
        }
    }
}

private fun localHost(value: String) = Endpoint.localHost(value)
