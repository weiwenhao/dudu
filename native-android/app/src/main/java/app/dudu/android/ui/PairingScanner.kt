package app.dudu.android.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.dudu.android.DuduViewModel
import app.dudu.android.data.Endpoint
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
@androidx.annotation.OptIn(markerClass = [androidx.camera.core.ExperimentalGetImage::class])
fun PairingScanner(model: DuduViewModel) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var denied by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it; denied = !it }
    var provider by remember { mutableStateOf<ProcessCameraProvider?>(null) }
    val active = remember { AtomicBoolean(true) }
    val found = remember { AtomicBoolean(false) }
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.CAMERA) }
    DisposableEffect(Unit) {
        onDispose { active.set(false); provider?.unbindAll(); scanner.close(); executor.shutdown() }
    }
    Page(w("对准电脑上显示的配对码"), model::backRoute) {
        if (!granted) {
            Text(if (denied) w("请在系统设置中允许相机访问。") else w("需要相机权限才能扫描配对码。"), Modifier.padding(24.dp))
            TextButton(onClick = { permission.launch(Manifest.permission.CAMERA) }) { Text(w("重试")) }
        } else AndroidView(modifier = Modifier.fillMaxSize(), factory = {
            PreviewView(context).apply {
                val previewView = this
                val future = ProcessCameraProvider.getInstance(context)
                future.addListener({
                    if (active.get()) runCatching {
                        val camera = future.get(); provider = camera
                        val preview = Preview.Builder().build().apply { surfaceProvider = previewView.surfaceProvider }
                        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                        analysis.setAnalyzer(executor) { frame ->
                            val image = frame.image
                            if (!active.get() || found.get() || image == null) frame.close()
                            else scanner.process(InputImage.fromMediaImage(image, frame.imageInfo.rotationDegrees))
                                .addOnSuccessListener { codes ->
                                    val link = codes.mapNotNull { it.rawValue }.firstOrNull { runCatching { Endpoint.parse(it) }.isSuccess }
                                    if (active.get() && link != null && found.compareAndSet(false, true)) {
                                        model.backRoute()
                                        model.connect(link)
                                    }
                                }.addOnCompleteListener { frame.close() }
                        }
                        camera.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                    }.onFailure { denied = true; granted = false }
                }, ContextCompat.getMainExecutor(context))
            }
        })
    }
}
