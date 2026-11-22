// A phone that is away cannot be told "the board changed" (owner, 2026-11-22: 「通过通知唤醒，然后将消息写入，避免打开手机 app 后拉几秒消息」). iOS suspends an App within seconds of its leaving the
// screen, so the held connection that tells a phone in front (native-board-changes.mjs) is gone, and the one thing that wakes a suspended App is a push from Apple. So when the board changes and
// a phone that asked for it (`board.wake`) has been quiet, it is sent one silent push (apns.mjs, kind `board`: no alert, no sound, no number), and the App, woken for a few seconds, reads the
// board and writes it down (`BoardWake.swift`), so that opening it shows the new rows and red dots at once instead of after a connect and a read.
//
// Apple does not promise to deliver these and asks for no more than two or three an hour, so a phone is sent at most one in `gapMs`: the first change after a quiet time goes at once, and whatever
// changes inside the gap goes as one more at its end. A phone that is in front, or has come back by then, is not sent one: it is told on its own connection.
//
// A reply or a question that nobody has read is different (native-board-announce.mjs): it is sent to the phones that are away as a notice that also wakes the App, at once and whatever the gap,
// because Apple delivers an alert and holds back only the silent kind. That starts the gap too, so a silent wake does not follow it at once.

export function createBoardWake({ candidates, isAway, wake, notice, gapMs = 3 * 60_000, now = Date.now }) {
  const phones = new Map(); // device id -> { sentAt, timer }
  let closed = false;

  function send(id, phone) {
    phone.timer = undefined;
    if (closed || !isAway(id)) return;
    phone.sentAt = now();
    // A wake that cannot be sent changes nothing: the App reads the board when it is opened.
    try { void Promise.resolve(wake(id)).catch(() => {}); } catch { /* same */ }
  }

  const phoneOf = (id) => {
    let phone = phones.get(id);
    if (!phone) { phone = { sentAt: -Infinity, timer: undefined }; phones.set(id, phone); }
    return phone;
  };

  return {
    /** A reply or a question that nobody has read: tell every phone that asked for it and is away, at once. */
    announce(event) {
      if (closed) return;
      for (const id of candidates()) {
        if (!isAway(id)) continue;
        const phone = phoneOf(id);
        clearTimeout(phone.timer); // what was waiting for the end of the gap is covered by this one
        phone.timer = undefined;
        phone.sentAt = now();
        try { void Promise.resolve(notice(id, event)).catch(() => {}); } catch { /* same */ }
      }
    },
    /** What the board shows changed: wake every phone that asked for it and is away, as often as the gap allows. */
    changed() {
      if (closed) return;
      for (const id of candidates()) {
        if (!isAway(id)) continue;
        const phone = phoneOf(id);
        if (phone.timer) continue;
        const wait = phone.sentAt + gapMs - now();
        if (wait <= 0) send(id, phone);
        else {
          phone.timer = setTimeout(() => send(id, phone), wait);
          phone.timer.unref?.();
        }
      }
    },
    close() {
      closed = true;
      for (const phone of phones.values()) clearTimeout(phone.timer);
      phones.clear();
    },
  };
}
