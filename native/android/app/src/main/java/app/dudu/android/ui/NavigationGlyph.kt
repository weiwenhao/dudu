package app.dudu.android.ui

import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.core.graphics.PathParser
import app.dudu.android.data.*
import org.json.JSONObject

@Composable
fun NavigationGlyph(icon: JSONObject?, iconSize: Int = 22) {
    val color = MaterialTheme.colorScheme.onSurface
    val raster = remember(icon) {
        icon?.nullableString("png")?.takeIf { it.length <= 16 * 1024 }?.let {
            runCatching {
                val bytes = android.util.Base64.decode(it, android.util.Base64.DEFAULT)
                val options = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                require(options.outWidth in 8..128 && options.outHeight in 8..128)
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
    }
    if (raster != null) Image(raster, null, Modifier.size(iconSize.dp), colorFilter = ColorFilter.tint(color))
    else {
        val box = icon?.optJSONArray("viewBox")
        val geometry = remember(icon) {
            icon?.rows("nodes")?.take(48)?.mapNotNull { node -> runCatching {
                fun n(key: String, fallback: Double = 0.0) = node.optDouble(key, fallback).toFloat()
                val path = when (node.optString("tag")) {
                    "path" -> PathParser.createPathFromPathData(node.optString("d").take(4096)) ?: Path()
                    "rect" -> Path().apply { addRoundRect(RectF(n("x"), n("y"), n("x") + n("width"), n("y") + n("height")), n("rx"), n("ry", node.optDouble("rx")), Path.Direction.CW) }
                    "circle" -> Path().apply { addCircle(n("cx"), n("cy"), n("r"), Path.Direction.CW) }
                    "ellipse" -> Path().apply { addOval(RectF(n("cx") - n("rx"), n("cy") - n("ry"), n("cx") + n("rx"), n("cy") + n("ry")), Path.Direction.CW) }
                    "line" -> Path().apply { moveTo(n("x1"), n("y1")); lineTo(n("x2"), n("y2")) }
                    else -> Path().apply {
                        val points = node.optString("points").take(2048).trim().split(Regex("[ ,]+"))
                            .mapNotNull(String::toFloatOrNull).chunked(2).filter { it.size == 2 }
                        points.forEachIndexed { i, point -> if (i == 0) moveTo(point[0], point[1]) else lineTo(point[0], point[1]) }
                        if (node.optString("tag") == "polygon") close()
                    }
                }
                if (node.optString("fillRule") == "evenodd") path.fillType = Path.FillType.EVEN_ODD
                node.optJSONArray("matrix")?.takeIf { it.length() == 6 }?.let { matrix ->
                    path.transform(android.graphics.Matrix().apply { setValues(floatArrayOf(
                        matrix.getDouble(0).toFloat(), matrix.getDouble(2).toFloat(), matrix.getDouble(4).toFloat(),
                        matrix.getDouble(1).toFloat(), matrix.getDouble(3).toFloat(), matrix.getDouble(5).toFloat(), 0f, 0f, 1f)) })
                }
                path to node
            }.getOrNull() }.orEmpty()
        }
        Canvas(Modifier.size(iconSize.dp)) {
            if (box != null && box.length() == 4 && box.optDouble(2) > 0 && box.optDouble(3) > 0) drawIntoCanvas { wrapper ->
                val canvas = wrapper.nativeCanvas
                canvas.save()
                val scale = minOf(size.width / box.optDouble(2).toFloat(), size.height / box.optDouble(3).toFloat())
                canvas.translate((size.width - box.optDouble(2).toFloat() * scale) / 2,
                    (size.height - box.optDouble(3).toFloat() * scale) / 2)
                canvas.scale(scale, scale)
                canvas.translate(-box.optDouble(0).toFloat(), -box.optDouble(1).toFloat())
                geometry.forEach { (path, node) ->
                    for (kind in listOf("fill", "stroke")) {
                        val paintColor = node.optString(kind, if (kind == "stroke") "currentColor" else "none")
                        if (paintColor != "none") {
                            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                                this.color = if (paintColor == "currentColor") color.toArgb()
                                    else runCatching { android.graphics.Color.parseColor(paintColor) }.getOrDefault(color.toArgb())
                                alpha = (node.optDouble("opacity", 1.0).coerceIn(0.0, 1.0) * 255).toInt()
                                style = if (kind == "fill") Paint.Style.FILL else Paint.Style.STROKE
                                strokeWidth = node.optDouble("strokeWidth", 1.75).toFloat()
                                strokeCap = when (node.optString("strokeLinecap")) { "butt" -> Paint.Cap.BUTT; "square" -> Paint.Cap.SQUARE; else -> Paint.Cap.ROUND }
                                strokeJoin = when (node.optString("strokeLinejoin")) { "bevel" -> Paint.Join.BEVEL; "miter" -> Paint.Join.MITER; else -> Paint.Join.ROUND }
                            }
                            canvas.drawPath(path, paint)
                        }
                    }
                }
                canvas.restore()
            }
        }
    }
}
