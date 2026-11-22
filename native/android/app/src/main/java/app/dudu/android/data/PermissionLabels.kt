package app.dudu.android.data

/**
 * DSH shows its built-in permission presets under its own names while the computer reports their ids ("read-only"): the iPhone's `PermissionLabels`. A built-in preset whose name is still
 * its id (or DSH's stock English, or the Chinese itself) is shown under DSH's name; any other name the computer sends is kept, and a kebab-case one is title-cased. The words themselves
 * are said by `permissionName` in the app's language.
 */
object PermissionLabels {
    /** The id, DSH's Chinese name (a key of the app's words) and its stock English label. */
    private val builtIn = mapOf(
        "read-only" to ("仅可查看" to "Read Only"),
        "workspace-write" to ("工作区内修改" to "Workspace Write"),
        "danger-full-access" to ("完全权限" to "Full access"),
        "auto" to ("自动审查" to "Auto review"),
    )

    /** The Chinese key of DSH's name for this preset, or null when the computer's own name is to be shown. */
    fun key(id: String, name: String): String? = builtIn[id]?.takeIf { (zh, english) -> name == id || name == english || name == zh }?.first

    /** The computer's own name, a kebab-case one title-cased ("plan-only" → "Plan Only"). */
    fun shown(name: String): String =
        if (name.matches(Regex("^[a-z0-9]+(-[a-z0-9]+)*$"))) name.split("-").joinToString(" ") { it.replaceFirstChar(Char::uppercaseChar) }
        else name
}
