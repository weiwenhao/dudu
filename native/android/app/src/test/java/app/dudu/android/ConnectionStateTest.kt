package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ConnectionStateTest {
    @Test fun permanentPairingFailuresCannotBeTreatedAsNetworkRetries() {
        listOf("INVALID_LINK", "MISSING_CREDENTIAL", "INSECURE_PUBLIC", "AUTH_FAILED", "UNAUTHORIZED", "IDENTITY_MISMATCH").forEach {
            assertTrue(requiresNewPairing(it))
            assertFalse(retriesConnection(it))
            assertFalse(isConnectionProblem(it))
        }
        // A plugin that asks to be updated is not a pairing to redo, and is not tried again by itself either (the iPhone's `shouldRetryConnection`).
        assertFalse(requiresNewPairing("AUTH_REQUIRED"))
        assertFalse(retriesConnection("AUTH_REQUIRED"))
        listOf("CONNECTION_FAILED", "UPSTREAM_UNAVAILABLE", "UPSTREAM_DISCONNECTED", "TIMEOUT", "DISCONNECTED",
            "ROUTES_UNAVAILABLE", "ROUTES_UNAVAILABLE_LAN").forEach {
            assertTrue(isConnectionProblem(it))
            assertFalse(requiresNewPairing(it))
            assertTrue(retriesConnection(it))
        }
        assertFalse(requiresNewPairing(null))
        assertTrue(retriesConnection(null))
        assertFalse(requiresNewPairing("PROTOCOL_ERROR"))
    }

    @Test fun reconnectionWaitsLongerAfterEachFailureUpToThirtySeconds() {
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), (1..7).map(::reconnectDelayMillis))
        assertEquals(1_000L, reconnectDelayMillis(0))
    }

    @Test fun unreachableAddressesSayWhichKindFailedAndBadLinksSayWhy() {
        assertEquals("ROUTES_UNAVAILABLE_LAN", routeFailure("CONNECTION_FAILED", hasLan = true, hasPublic = false))
        assertEquals("ROUTES_UNAVAILABLE", routeFailure("TIMEOUT", hasLan = true, hasPublic = true))
        assertEquals("TIMEOUT", routeFailure("TIMEOUT", hasLan = false, hasPublic = true))
        assertEquals("AUTH_FAILED", routeFailure("AUTH_FAILED", hasLan = true, hasPublic = true))
        val token = "a".repeat(43)
        assertEquals("MISSING_CREDENTIAL", pairingLinkFailure("https://host.example/?pair=short"))
        assertEquals("MISSING_CREDENTIAL", pairingLinkFailure("https://host.example/?pair=$token&pair=$token"))
        assertEquals("INSECURE_PUBLIC", pairingLinkFailure("ws://public.example/?pair=$token"))
        assertEquals("INVALID_LINK", pairingLinkFailure("https://user:secret@host.example/?pair=$token"))
        assertEquals("INVALID_LINK", pairingLinkFailure("not a link"))
    }

    @Test fun anAppLinkOpensThePairingFormWithTheLinkItCarries() {
        val inner = "http://192.168.1.2:3170/?pair=${"a".repeat(43)}&name=Studio%20Mac"
        val wrapped = "dudu://connect?url=" + java.net.URLEncoder.encode(inner, "UTF-8")
        assertEquals(inner, pairingLinkTarget(wrapped))
        assertEquals(inner, pairingLinkTarget(wrapped.replace("dudu://", "harness-mobile://")))
        assertNull(pairingLinkTarget(inner))
        assertNull(pairingLinkTarget("dudu://elsewhere?url=x"))
        assertNull(pairingLinkTarget("dudu://connect"))
        assertEquals("Studio Mac", pairingLinkName(inner))
        assertEquals("", pairingLinkName("https://host.example/?pair=x"))
    }

    @Test fun clearingTransientErrorsRetainsPairingRecoveryAndComputerScopedContent() {
        val home = Home.parse(JSONObject("""{"outcome":"success","tab":"all","pins":[],
            "unreadCount":0,"conversations":[]}"""), Scope.All)
        val saved = SavedComputer("mac", "Host", "https://host.example/dsbot?pair=${"a".repeat(43)}")
        assertThrows(IllegalArgumentException::class.java) { Endpoint.parse(saved.link) }
        val failed = UiState(initialized = true, computerId = saved.id, computer = saved.name,
            computers = listOf(saved), home = home, problem = "INVALID_LINK", connectionFailure = "INVALID_LINK",
            pairingRequired = true)
        val dismissed = failed.copy(panel = null, problem = null)
        assertTrue(dismissed.showsConnectionGuide)
        assertSame(home, dismissed.home)
        assertEquals(saved, dismissed.computers.single())
        // Pairing remains manual; no credentials or cached conversations are rewritten or discarded.
        assertEquals(saved.link, dismissed.computers.single().link)
        assertTrue(dismissed.copy(connecting = true).showsConnectionGuide)
        // A failed new pairing attempt must not return to an offline board with an unusable old link.
        assertTrue(dismissed.copy(connectionFailure = "CONNECTION_FAILED").showsConnectionGuide)
        assertFalse(dismissed.copy(connected = true, connectionFailure = null, pairingRequired = false).showsConnectionGuide)
    }

    @Test fun ordinaryDisconnectsAndOpenConversationsRetainTheirCurrentContent() {
        val disconnected = UiState(initialized = true, computerId = "mac", connectionFailure = "CONNECTION_FAILED")
        assertFalse(disconnected.showsConnectionGuide)
        val expired = disconnected.copy(connectionFailure = "AUTH_FAILED")
        assertTrue(expired.showsConnectionGuide)
        // A plugin to update shows the guide too (its button is 重新连接, not a new pairing).
        assertTrue(disconnected.copy(connectionFailure = "AUTH_REQUIRED").showsConnectionGuide)
        assertFalse(disconnected.copy(connectionFailure = "ROUTES_UNAVAILABLE").showsConnectionGuide)
        assertFalse(expired.copy(conversationTitle = "Retained conversation").showsConnectionGuide)
        assertTrue(UiState(initialized = true).showsConnectionGuide)
        assertFalse(expired.copy(connected = true).showsConnectionGuide)
    }
}
