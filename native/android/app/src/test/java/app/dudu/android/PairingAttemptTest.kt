package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.*
import org.junit.Test

// 2026-11-27: the card of a computer that could not be reached shows the link's own name and address (the iPhone's `PairingAttempt`), and the line under it the phone's own network.
class PairingAttemptTest {
    private val token = "c".repeat(43)

    @Test fun pairingTheSameComputerUpdatesItsExistingRecord() {
        val first = SavedComputer("mac", "Studio", "https://old.example.test/?pair=$token")
        val repeated = emptyList<SavedComputer>().updating(first).updating(first)
        assertEquals(listOf(first), repeated)

        val newToken = "d".repeat(43)
        val replacement = first.copy(link = "https://new.example.test/?pair=$newToken")
        assertEquals(listOf(replacement), repeated.updating(replacement))
    }

    @Test fun theAttemptNamesTheComputerAsTheLinkDoesAndShowsItsLanAddress() {
        val attempt = pairingAttemptOf("http://192.168.31.201:3170/?pair=$token&name=Studio", "ROUTES_UNAVAILABLE_LAN")!!
        assertEquals("Studio", attempt.name)
        assertEquals("192.168.31.201:3170", attempt.address)
        assertEquals("ROUTES_UNAVAILABLE_LAN", attempt.problem)
        // The link carries the pairing token: it never shows in what is printed.
        assertFalse(attempt.toString().contains(token))
    }

    @Test fun aLinkWithoutANameIsNamedByTheComputerItReaches() {
        val attempt = pairingAttemptOf("http://192.168.31.201:3170/?pair=$token", "CONNECTION_FAILED")!!
        assertEquals("192.168.31.201", attempt.name)
    }

    @Test fun aTextThatIsNoLinkIsNoAttempt() {
        assertNull(pairingAttemptOf("hello", "INVALID_LINK"))
        assertNull(pairingAttemptOf("http://192.168.31.201:3170/", "MISSING_CREDENTIAL"))
    }

    @Test fun theLineUnderTheCardSaysThePhoneTheNetworkAndTheAddress() {
        assertEquals("本机 · Wi-Fi · 192.168.31.88", PhoneNetwork(PhoneNetwork.Kind.Wifi, "192.168.31.88").footnote("本机", "蜂窝网络"))
        assertEquals("本机 · 蜂窝网络 · 10.20.30.40", PhoneNetwork(PhoneNetwork.Kind.Cellular, "10.20.30.40").footnote("本机", "蜂窝网络"))
        // What the phone does not know is left out, with its separator.
        assertEquals("本机", PhoneNetwork(PhoneNetwork.Kind.Other, null).footnote("本机", "蜂窝网络"))
    }
}
