package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.*
import org.junit.Test

class RecordTalkTest {
    @Test fun aTalkNamesTheSenderWhereItChangesAndTheDayWhereItStarts() {
        val lines = talkLines(listOf(
            json("at" to "11-17 19:15", "from" to "陈明", "text" to "a"),
            json("at" to "11-17 19:16", "from" to "陈明", "text" to "b"),
            json("at" to "11-17 19:17", "from" to "魏文豪", "text" to "c"),
            json("at" to "11-18 09:04", "from" to "魏文豪", "text" to "d"),
            json("at" to "11-18 09:05", "from" to null, "text" to "e"),
        ))
        assertEquals(listOf(true, false, false, true, false), lines.map { it.startsDay })
        assertEquals(listOf(true, false, true, true, false), lines.map { it.showsName })
        assertEquals(listOf("19:15", "19:16", "19:17", "09:04", "09:05"), lines.map { it.time })
        assertEquals("11-18", lines.last().day)
    }

    @Test fun aRecordIsHandledWhenTheOwnerMarkedItOrAnIssueHoldsIt() {
        assertEquals("todo", recordTab(json("done" to false, "issue" to null)))
        assertEquals("done", recordTab(json("done" to true, "issue" to null)))
        assertEquals("done", recordTab(json("done" to false, "issue" to json("id" to 7))))
    }
}
