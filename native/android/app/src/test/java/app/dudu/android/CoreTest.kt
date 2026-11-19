package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.URLEncoder

class CoreTest {
    private val token = "a".repeat(43)

    @Test fun pairingKeepsCredentialsOutOfOriginsAndRejectsAmbiguousLinks() {
        val endpoint = Endpoint.parse("https://host.example/?pair=$token&computer=mac&device=phone")
        assertEquals("https://host.example", endpoint.origin)
        assertFalse(endpoint.toString().contains(token))
        listOf(
            "https://user:password@host.example/?pair=$token",
            "https://host.example/?pair=$token&pair=$token",
            "https://host.example/?pair=$token#fragment",
            "https://host.example/other?pair=$token",
            "https://host.example/?pair=$token&device=phone",
            "ws://public.example/?pair=$token",
            "https://host.example/?pair=$token&lan=http%3A%2F%2F192.168.1.2",
            "https://host.example/?pair=$token&computer=mac&device=phone&lan=https%3A%2F%2Fuser%3Apass%40private.example",
        ).forEach { value -> assertThrows(IllegalArgumentException::class.java) { Endpoint.parse(value) } }
        assertEquals("http://192.168.1.2:3170",
            Endpoint.parse("ws://192.168.1.2:3097/?pair=$token").origin)
        val inner = URLEncoder.encode("http://localhost:3170/?pair=$token", "UTF-8")
        assertEquals("http://localhost:3170", Endpoint.parse("dudu://connect?url=$inner").origin)
        val routes = Endpoint.parse("https://host.example/?pair=$token&computer=mac&device=phone" +
            "&lan=http%3A%2F%2F192.168.1.2%3A3170&public=https%3A%2F%2Fhost.example")
        assertEquals(listOf("lan", "public"), routes.addresses.map { it.kind })
        val selected = Endpoint.parse(routes.selecting(routes.addresses.first()).storedLink())
        assertEquals("http://192.168.1.2:3170", selected.origin)
        assertEquals(routes.addresses, selected.addresses)
        assertEquals("phone", selected.deviceId)
        val edited = selected.withAddresses(listOf(ConnectionAddress.parse("https://new.example", "public")))
        assertEquals("https://new.example", edited.origin)
        val saved = SavedComputer("mac", "Host", edited.storedLink(), addressesEdited = true)
        assertEquals(saved, SavedComputer.parse(saved.json()))
        assertThrows(IllegalArgumentException::class.java) {
            ConnectionAddress.validate(listOf(ConnectionAddress("http://localhost", "lan"), ConnectionAddress("http://localhost", "public")))
        }
    }

    @Test fun missingHomepageContractCannotSilentlyBecomeAnEmptyList() {
        assertThrows(org.json.JSONException::class.java) {
            Home.parse(JSONObject("""{"outcome":"success","tab":"active","groups":[]}"""), Scope.Active)
        }
        val answer = JSONObject("""{"outcome":"success","tab":"backlog","pins":["assistant"],
          "unreadCount":0,"conversations":[{"id":"assistant","title":"Dudu","preview":"","receivedAt":0,
          "sessionState":"idle","unread":false,"readSeq":-1,"pinned":true}]}""")
        assertTrue(Home.parse(answer, Scope.Backlog).rows.isEmpty())
        assertThrows(IllegalArgumentException::class.java) { Home.parse(answer, Scope.Active) }
    }

    @Test fun assignmentRequiresAProjectFolderAndNeverInfersWorkflow() {
        val invalid = IssueDraft(title = "Research", agent = "codex", project = Project("dudu", null))
        assertFalse(invalid.valid)
        val draft = invalid.copy(project = Project("dudu", "/work/dudu"), status = "backlog")
        assertTrue(draft.valid)
        val params = draft.params()
        assertEquals("backlog", params.getString("status"))
        assertEquals("/work/dudu", params.getJSONObject("project").getString("path"))
        assertEquals("codex", params.getString("agent"))
    }

    @Test fun issuePicturesStayInTheCreationRequestAndCannotSubmitWhilePreparing() {
        val image = json("name" to "photo.jpg", "mimeType" to "image/jpeg", "dataBase64" to "fixture")
        val draft = IssueDraft(title = "Review", photos = listOf(image))
        assertFalse(draft.copy(preparingPhotos = true).valid)
        assertEquals("fixture", draft.params().getJSONArray("attachments").getJSONObject(0).getString("dataBase64"))
        assertFalse(draft.params().has("preparingPhotos"))
        assertFalse(draft.copy(photos = emptyList()).params().has("attachments"))
    }

    @Test fun editingAnExistingIssueRetainsItsDueDateAndLabelIds() {
        val issue = Issue.parse(JSONObject("""{"id":27,"title":"Research","status":"backlog","agent":null,
          "dueAt":1795003200000,"labels":[{"id":4,"name":"Release"},{"id":8,"name":"Backend"}],
          "projectInfo":{"name":"dudu","path":"/work/dudu"}}"""))
        assertEquals(1795003200000L, issue.dueAt)
        assertEquals(setOf(4L, 8L), issue.labelIds)
        assertEquals(Project("dudu", "/work/dudu"), issue.project)
        assertEquals("backlog", issue.status)
        val oldRow = Issue.parse(JSONObject("""{"id":28,"title":"Older","status":"todo"}"""))
        assertNull(oldRow.dueAt)
        assertTrue(oldRow.labelIds.isEmpty())
    }

    @Test fun admittedAndCanceledInputsCannotReappearAsLocalOrQueuedDuplicates() {
        val local = Message("request-1", "user", "Continue", false, "request-1")
        val admitted = local.copy(id = "journal-17")
        val queued = local.copy(id = "queue-4")
        val session = Session("session", "watch", listOf(admitted), listOf(queued), null, "idle")
        assertTrue(session.observed("request-1"))
        assertEquals(listOf(admitted), session.visibleMessages(local))
        val canceled = session.copy(messages = emptyList(), canceledRequestIds = setOf("request-1"))
        assertTrue(canceled.observed("request-1"))
        assertTrue(canceled.visibleMessages(local).isEmpty())
        assertFalse(session.observed("another-request"))
    }

    @Test fun tailRefreshKeepsLoadedPagesAndNeverRevivesHiddenEntries() {
        val older = JSONObject("""{"beforeSeq":1,"throughSeq":20,"hasMore":true,
          "entries":[{"id":"a","type":"user","seq":1,"text":"first"},
            {"id":"b","type":"assistant","seq":8,"text":"old"}],
          "turns":[{"turn":1,"start":100,"files":[{"id":"file-a"}]}],
          "tools":{"call":{"seq":6}}}""")
        val next = JSONObject("""{"beforeSeq":8,"throughSeq":30,"hasMore":true,
          "entries":[{"id":"b","type":"assistant","seq":8,"text":"updated"}],
          "turns":[{"turn":1,"end":200,"files":[{"id":"file-b"}]}],
          "tools":{"call":{"seq":6,"resultSeq":10,"status":"done"}},"hidden":[1]}""")
        val merged = mergeTranscript(older, next)
        assertEquals(1, merged.getLong("beforeSeq"))
        assertEquals(1, merged.rows("entries").size)
        assertEquals("updated", merged.rows("entries").single().getString("text"))
        assertEquals(100, merged.rows("turns").single().getInt("start"))
        assertEquals(2, merged.rows("turns").single().rows("files").size)
        assertEquals(10, merged.getJSONObject("tools").getJSONObject("call").getInt("resultSeq"))
        val latePage = mergeTranscript(merged, older)
        assertEquals(30, latePage.getInt("throughSeq"))
        assertEquals("updated", latePage.rows("entries").single().getString("text"))
        val cache = cachedSession(json("session" to json("id" to "s", "state" to "running"),
            "questions" to org.json.JSONArray(), "approvals" to org.json.JSONArray(),
            "queuedMessages" to org.json.JSONArray(), "readPosition" to json("seq" to 10),
            "transcript" to merged.put("live", json("id" to "live")).put("pendingInputs", org.json.JSONArray())))
        assertFalse(cache.has("questions")); assertFalse(cache.has("approvals"))
        assertFalse(cache.has("readPosition")); assertFalse(cache.getJSONObject("transcript").has("live"))
        assertFalse(cache.getJSONObject("transcript").has("pendingInputs"))
    }

    @Test fun pageScopesBindIdentityOriginPathAndRejectTraversal() {
        val id = "6d066ad0-3fe9-4988-8f46-d56e64033a46"
        val reply = json("id" to id, "computerId" to "mac", "cookie" to "p".repeat(43), "path" to "/ui/$id/")
        val page = OpenPage.parse(reply, "https://mac.example:3170", "mac")
        assertTrue(page.allows(page.url + "rpc"))
        listOf("https://evil.example${page.path}", "https://mac.example${page.path}",
            page.url + "../other/", page.url + "%2e%2e/other", page.url + "x%2fy",
            "https://mac.example:3170/api/v1/request", "file:///etc/passwd").forEach {
            assertFalse(it, page.allows(it))
        }
        assertThrows(IllegalArgumentException::class.java) { OpenPage.parse(reply, page.origin, "other") }
    }

    @Test fun multipleAcceptedInputsSurviveQueueAdmissionAndReopening() {
        val one = Outgoing("one", "First", emptyList(), accepted = true)
        val two = Outgoing("two", "Second", listOf(json("receiptId" to "file")), failed = true)
        val restored = listOf(one, two).map { Outgoing.parse(JSONObject(it.json().toString())) }
        assertEquals(listOf("one", "two"), restored.map { it.requestId })
        val admitted = Message("log-1", "user", "First", false, "one")
        val current = Session("s", "watch", listOf(admitted), emptyList(), null, "idle")
        val visible = current.visibleMessages(restored.map { it.message() })
        assertEquals(listOf("log-1", "two"), visible.map { it.id })
        assertEquals("file", restored.last().attachments.single().getString("receiptId"))
    }
}
