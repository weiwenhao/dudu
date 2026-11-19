package app.dudu.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class Vault(context: Context) {
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val directory = File(context.noBackupFilesDir, "dudu")
    private val key: SecretKey by lazy {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("dudu.storage", null) as? SecretKey) ?: KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
        ).apply {
            init(KeyGenParameterSpec.Builder("dudu.storage",
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    suspend fun read(name: String): String? = locks.getOrPut(name) { Mutex() }.withLock { withContext(Dispatchers.IO) {
        try {
            val bytes = AtomicFile(file(name)).readFully()
            val ivSize = bytes[0].toInt()
            require(ivSize == 12 && bytes.size > 29)
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
                String(doFinal(bytes.copyOfRange(13, bytes.size)), Charsets.UTF_8)
            }
        } catch (_: Exception) { null }
    } }

    suspend fun write(name: String, value: String) = locks.getOrPut(name) { Mutex() }.withLock { withContext(Dispatchers.IO) {
        directory.mkdirs()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
        val bytes = byteArrayOf(cipher.iv.size.toByte()) + cipher.iv + cipher.doFinal(value.toByteArray())
        val atomic = AtomicFile(file(name))
        val stream = atomic.startWrite()
        try {
            stream.write(bytes)
            atomic.finishWrite(stream)
        } catch (error: Exception) {
            atomic.failWrite(stream)
            throw error
        }
    } }

    suspend fun delete(name: String) = locks.getOrPut(name) { Mutex() }.withLock {
        withContext(Dispatchers.IO) { AtomicFile(file(name)).delete() }
    }

    private fun file(name: String): File {
        require(name.matches(Regex("[A-Za-z0-9_.-]{1,160}")))
        return File(directory, name)
    }
}
