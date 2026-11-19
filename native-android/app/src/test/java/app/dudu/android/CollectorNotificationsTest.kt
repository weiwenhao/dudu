package app.dudu.android

import app.dudu.android.data.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CollectorNotificationsTest {
    private fun body(id: String) = json("section" to "collectors", "name" to "notify", "args" to json("id" to id))

    @Test fun independentSavesUpdateImmediatelyAndOlderPagesCannotClearTheirConfirmation() = runTest {
        val requests = mutableListOf<Pair<JSONObject, CompletableDeferred<Unit>>>()
        val notifications = CollectorNotifications(this, { 1 }) {
            val reply = CompletableDeferred<Unit>()
            requests += it to reply
            reply.await()
        }
        val before = notifications.checkpoint()
        notifications.set("a", false, true, body("a")) { fail(it) }
        notifications.set("b", false, true, body("b")) { fail(it) }
        assertTrue(notifications.state.value.getValue("a").on)
        assertTrue(notifications.state.value.getValue("b").on)
        runCurrent()
        assertEquals(2, requests.size)
        requests[1].second.complete(Unit)
        runCurrent()
        requests[0].second.complete(Unit)
        runCurrent()
        notifications.receive(before)
        assertTrue(notifications.state.value.values.all { it.on && !it.saving })
        notifications.receive(notifications.checkpoint())
        assertTrue(notifications.state.value.isEmpty())
    }

    @Test fun repeatedTapsKeepOneRequestInFlightAndSaveOnlyTheLatestSelection() = runTest {
        val requests = mutableListOf<Pair<Boolean, CompletableDeferred<Unit>>>()
        val notifications = CollectorNotifications(this, { 1 }) {
            val reply = CompletableDeferred<Unit>()
            requests += it.getString("value").toBoolean() to reply
            reply.await()
        }
        notifications.set("a", false, true, body("a")) { fail(it) }
        runCurrent()
        notifications.set("a", false, false, body("a")) { fail(it) }
        notifications.set("a", false, true, body("a")) { fail(it) }
        notifications.set("a", false, false, body("a")) { fail(it) }
        assertFalse(notifications.state.value.getValue("a").on)
        assertEquals(1, requests.size)
        requests[0].second.complete(Unit)
        runCurrent()
        assertEquals(listOf(true, false), requests.map { it.first })
        requests[1].second.complete(Unit)
        runCurrent()
        assertFalse(notifications.state.value.getValue("a").on)
        assertFalse(notifications.state.value.getValue("a").saving)
    }

    @Test fun failuresRestoreTheConfirmedValueAndChangedIntentStillSavesAfterALostReply() = runTest {
        val replies = mutableListOf<CompletableDeferred<Unit>>()
        val sent = mutableListOf<Boolean>()
        val errors = mutableListOf<String>()
        val notifications = CollectorNotifications(this, { 1 }) {
            val reply = CompletableDeferred<Unit>()
            replies += reply
            sent += it.getString("value").toBoolean()
            reply.await()
        }
        notifications.set("a", false, true, body("a")) { errors += it }
        runCurrent()
        replies[0].completeExceptionally(ApiFailure("UPSTREAM_ERROR"))
        runCurrent()
        assertFalse(notifications.state.value.getValue("a").on)
        assertEquals(listOf("UPSTREAM_ERROR"), errors)
        assertEquals(1, sent.size)

        notifications.set("a", false, true, body("a")) { errors += it }
        runCurrent()
        notifications.set("a", false, false, body("a")) { errors += it }
        replies[1].completeExceptionally(ApiFailure("CONNECTION_FAILED"))
        runCurrent()
        assertEquals(listOf(true, true, false), sent)
        replies[2].complete(Unit)
        runCurrent()
        assertFalse(notifications.state.value.getValue("a").on)
        assertEquals(listOf("UPSTREAM_ERROR"), errors)
    }

    @Test fun oldConnectionsCannotChangeOrClearANewerSave() = runTest {
        var connection = 1
        val replies = mutableListOf<CompletableDeferred<Unit>>()
        val notifications = CollectorNotifications(this, { connection }) {
            val reply = CompletableDeferred<Unit>()
            replies += reply
            reply.await()
        }
        notifications.set("a", false, true, body("a")) { fail(it) }
        runCurrent()
        connection++
        notifications.set("a", true, false, body("a")) { fail(it) }
        runCurrent()
        replies[1].complete(Unit)
        runCurrent()
        replies[0].completeExceptionally(ApiFailure("CONNECTION_FAILED"))
        runCurrent()
        assertFalse(notifications.state.value.getValue("a").on)
        assertFalse(notifications.state.value.getValue("a").saving)
    }
}
