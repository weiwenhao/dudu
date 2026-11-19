package app.dudu.android.data

fun isConnectionProblem(code: String): Boolean =
    code in setOf("CONNECTION_FAILED", "UPSTREAM_UNAVAILABLE", "UPSTREAM_DISCONNECTED")
