package app.dudu.android.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address

/**
 * The phone's own network, for the line under the card of a computer that could not be reached (the iPhone's `PhoneNetwork`; owner, 2026-11-27: 「本机 · Wi-Fi · 192.168.31.88」): how the phone is
 * connected and its own IPv4 address on that network, which is what a LAN address of the computer has to be able to reach.
 */
data class PhoneNetwork(val kind: Kind, val address: String?) {
    enum class Kind { Wifi, Cellular, Other }

    /** `本机 · Wi-Fi · 192.168.31.88`: the words of the phone, of the cellular network, and the address; what the phone does not know is left out. */
    fun footnote(phone: String, cellular: String): String =
        listOfNotNull(phone, when (kind) { Kind.Wifi -> "Wi-Fi"; Kind.Cellular -> cellular; Kind.Other -> null }, address).joinToString(" · ")

    companion object {
        /** What the system says now; null without a network at all. */
        fun current(context: Context): PhoneNetwork? {
            val manager = context.getSystemService(ConnectivityManager::class.java) ?: return null
            val network = manager.activeNetwork ?: return null
            val capabilities = manager.getNetworkCapabilities(network)
            val kind = when {
                capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> Kind.Wifi
                capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> Kind.Cellular
                else -> Kind.Other
            }
            val address = manager.getLinkProperties(network)?.linkAddresses?.map { it.address }
                ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
            return PhoneNetwork(kind, address)
        }
    }
}
