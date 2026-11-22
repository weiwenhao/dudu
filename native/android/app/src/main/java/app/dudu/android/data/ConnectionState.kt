package app.dudu.android.data

/** A computer that could not be reached, the iPhone's `isConnectionInterruption` family: the app shows its notice and tries again by itself. */
fun isConnectionProblem(code: String): Boolean =
    code in setOf("CONNECTION_FAILED", "UPSTREAM_UNAVAILABLE", "UPSTREAM_DISCONNECTED",
        "TIMEOUT", "DISCONNECTED", "ROUTES_UNAVAILABLE", "ROUTES_UNAVAILABLE_LAN")

/** What a plugin older than a method answers when it is asked for it (the iPhone's `featureMessage` lists the same two): the signal to use the older request instead. */
fun isUnsupportedMethod(code: String?): Boolean = code in setOf("UNSUPPORTED", "METHOD_NOT_ALLOWED")

/** These failures need the owner's pairing action, not a network reconnect (the iPhone's `requiresNewPairing`). A plugin that asks to be updated (`AUTH_REQUIRED`) is not one of them. */
fun requiresNewPairing(code: String?): Boolean =
    code in setOf("INVALID_LINK", "MISSING_CREDENTIAL", "INSECURE_PUBLIC",
        "IDENTITY_MISMATCH", "AUTH_FAILED", "UNAUTHORIZED")

/** Whether the app may try this computer again by itself (the iPhone's `shouldRetryConnection`): not after a pairing failure, nor when the plugin asks to be updated. */
fun retriesConnection(code: String?): Boolean = !requiresNewPairing(code) && code != "AUTH_REQUIRED"

/**
 * How long to wait before the `attempt`-th try of a computer that could not be reached (the iPhone's `scheduleReconnect`): 1, 2, 4, 8, 16 s, then every 30 s; a successful connection
 * starts again from the first.
 */
fun reconnectDelayMillis(attempt: Int): Long = minOf(30, 1 shl (attempt.coerceAtLeast(1) - 1).coerceAtMost(5)) * 1000L

/**
 * A computer none of whose addresses answered (the iPhone's `routeFailure`): with a LAN address among them it says which kind could not be reached (`ROUTES_UNAVAILABLE_LAN` when it has
 * only LAN addresses, `ROUTES_UNAVAILABLE` when the public ones failed too); a computer known only by its public address keeps the failure it had (`TIMEOUT`, `CONNECTION_FAILED`).
 */
fun routeFailure(code: String, hasLan: Boolean, hasPublic: Boolean): String =
    if (code !in setOf("CONNECTION_FAILED", "TIMEOUT") || !hasLan) code
    else if (hasPublic) "ROUTES_UNAVAILABLE" else "ROUTES_UNAVAILABLE_LAN"

/**
 * Why a pairing link cannot be used, in the iPhone's words (`ConnectionEndpoint.parse`): no single 43-character pairing token (`MISSING_CREDENTIAL`), an unencrypted `ws:` address that is
 * not on the local network (`INSECURE_PUBLIC`), anything else `INVALID_LINK`. Asked only for a link `Endpoint.parse` refused.
 */
fun pairingLinkFailure(value: String): String {
    val link = pairingLinkTarget(value) ?: value.trim()
    val uri = runCatching { java.net.URI(link) }.getOrNull() ?: return "INVALID_LINK"
    if (uri.host.isNullOrEmpty()) return "INVALID_LINK"
    val tokens = queryItems(uri.rawQuery)["pair"]
    if (tokens?.size != 1 || !tokens.single().matches(Regex("[A-Za-z0-9_-]{43}"))) return "MISSING_CREDENTIAL"
    if (uri.scheme?.lowercase() == "ws" && !Endpoint.localHost(uri.host)) return "INSECURE_PUBLIC"
    return "INVALID_LINK"
}

/** The pairing link inside `dudu://connect?url=…` (or `harness-mobile://connect`), as the iPhone's `handlePairingURL` takes it: null for anything else. */
fun pairingLinkTarget(value: String): String? {
    val uri = runCatching { java.net.URI(value.trim()) }.getOrNull() ?: return null
    if (uri.scheme?.lowercase() !in setOf("dudu", "harness-mobile") || uri.host?.lowercase() != "connect") return null
    return queryItems(uri.rawQuery)["url"]?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
}

/** The computer's name a pairing link carries (`name`), for the form's 电脑名称 (the iPhone's `pairingName(from:)`). */
fun pairingLinkName(link: String): String =
    runCatching { queryItems(java.net.URI(link.trim()).rawQuery)["name"]?.firstOrNull() }.getOrNull().orEmpty()

private fun queryItems(raw: String?): Map<String, List<String>> =
    raw?.split("&")?.filter { it.isNotEmpty() }?.groupBy(
        { java.net.URLDecoder.decode(it.substringBefore("="), "UTF-8") },
        { java.net.URLDecoder.decode(it.substringAfter("=", ""), "UTF-8") },
    ) ?: emptyMap()
