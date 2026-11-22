package app.dudu.android.ui

import androidx.compose.runtime.Composable
import app.dudu.android.data.PermissionLabels

/**
 * A permission preset under DSH's own name, in the app's language (the iPhone's `PermissionLabels.name`): 仅可查看, 工作区内修改, 完全权限, 自动审查 for DSH's four built-in presets, the
 * computer's own name for any other. The one place the app names a preset: the settings' choice and the conversation's + sheet use it.
 */
@Composable
fun permissionName(id: String, name: String): String = when (PermissionLabels.key(id, name)) {
    "仅可查看" -> w("仅可查看")
    "工作区内修改" -> w("工作区内修改")
    "完全权限" -> w("完全权限")
    "自动审查" -> w("自动审查")
    else -> PermissionLabels.shown(name)
}
