package app.dudu.android.data

/**
 * What the board shows at once for a pin or a read mark, before the computer answers, and how it is taken back when the computer refuses it: the iPhone's `BoardModel.changeHome`
 * (owner, 2026-11-22: the two phones behave the same). Only the one row changes; a failure restores that row alone, since another row may have finished a change of its own meanwhile,
 * and puts the pin back where it was in the shelf.
 */
object BoardChanges {
    /** The row pinned or unpinned: its mark, and its place at the end of the shelf (or out of it). */
    fun pinned(home: Home, id: String, pinned: Boolean): Home {
        val rows = home.rows.map { if (it.id == id) it.copy(pinned = pinned) else it }
        val pins = home.pins.filter { it != id } + if (pinned) listOf(id) else emptyList()
        return home.copy(rows = rows, pins = pins)
    }

    /** The row marked read or unread. A row whose agent is working keeps its working mark; otherwise the avatar's dot follows the mark. */
    fun read(home: Home, id: String, unread: Boolean): Home = home.copy(rows = home.rows.map {
        if (it.id != id) it
        else it.copy(unread = unread, sessionState = if (it.sessionState == "processing") it.sessionState else if (unread) "unread" else "idle")
    })

    /** Take back the change of one row: that row as it was `before`, and its pin at its old place (or out of the shelf when it had none). */
    fun restore(home: Home, before: Home, id: String): Home {
        val original = before.rows.firstOrNull { it.id == id }
        val rows = if (original == null) home.rows else home.rows.map { if (it.id == id) original else it }
        val pins = home.pins.filter { it != id }.toMutableList()
        val index = before.pins.indexOf(id)
        if (index >= 0) pins.add(minOf(index, pins.size), id)
        return home.copy(rows = rows, pins = pins)
    }

    /** Whether an event from the computer says that what the board shows changed: the app's events loop and the background service ask the same. */
    fun says(topic: String) = topic.startsWith("board.") || topic.startsWith("issue.") || topic.startsWith("sessions.")

    /**
     * Where the board of one computer is kept on the phone. The app writes it after every read and shows it at start; the background service writes it while the app is away
     * (owner, 2026-11-22: 「安卓也做」, as the iPhone's board is written while it is away), and the app takes a newer one when it comes back. Older builds wrote this name, so it
     * never changes: a different one would drop the board people already have.
     */
    fun cacheName(computerId: String, scope: Scope = Scope.All) = "home-$computerId-${scope.wire}"
}
