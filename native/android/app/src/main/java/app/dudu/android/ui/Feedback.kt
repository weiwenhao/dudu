package app.dudu.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.dudu.android.DuduViewModel
import app.dudu.android.R
import app.dudu.android.data.ToastKind
import app.dudu.android.data.isFeedbackEmail
import app.dudu.android.data.sendFeedback
import app.dudu.android.data.word
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The feedback sheet of the settings page (owner, 2026-11-27: 「反馈放在设置页不是放在这里，隐私条款下面放一个反馈弹窗呀」, 「只需要让用户填一个回信邮箱，其他的都不需要。你不需要显示出来我的邮箱，这都是我的隐私信息。」;
 * the iPhone has the same sheet). It is drawn as the new issue's: the bar (`FormSheetBar`: ✕, 反馈, a round ✓ named 发送, the new issue's own) and two of its fields, the text (four to eight lines) and the reply address
 * (one line, the email keyboard, no capitals, no autocorrect), and nothing else: no recipient, no log, no phone, no words that explain. The ✓ is grey until the text is not blank and the address
 * is one; while it goes it is a spinner, the fields cannot be edited and the sheet cannot be pulled down. Sent: the sheet closes and the settings page says 已发送 in the app's message. Not sent: 发送失败
 * in the short message at the top (1 s, no ✕, as the iPhone's), what was written stays, and the ✓ sends it again. The text and the address are kept over a turn of the phone, and are gone with the sheet.
 */
@Composable
internal fun FeedbackSheet(model: DuduViewModel, close: () -> Unit) {
    val context = LocalContext.current.applicationContext
    val language = appLocale().toLanguageTag()
    val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val canSend = text.isNotBlank() && isFeedbackEmail(email) && !sending
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    fun send() {
        if (!canSend) return
        sending = true
        scope.launch {
            val sent = try {
                sendFeedback(context, email, text, language)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                false
            }
            sending = false
            if (sent) {
                model.toast(word("已发送"), ToastKind.Success)
                close()
            } else model.toast(word("发送失败"), ToastKind.Error, millis = 1_000, showsClose = false)
        }
    }
    DuduSheet(close, canDismiss = !sending, containerColor = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxWidth().testTag("feedback-sheet")) {
            FormSheetBar(w("反馈"), close, cancelEnabled = !sending, action = DuduGlyphs.check, actionLabel = stringResource(R.string.send),
                actionEnabled = canSend, busy = sending, actionTag = "feedback-send", perform = ::send)
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                NewIssueField(text, w("请描述遇到的问题"), !sending, title = false, modifier = Modifier.focusRequester(focus).testTag("feedback-text")) {
                    text = it.take(20000)
                }
                NewIssueField(email, w("回信邮箱"), !sending, title = false, modifier = Modifier.testTag("feedback-email"), singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                        keyboardType = KeyboardType.Email, imeAction = ImeAction.Done)) {
                    email = it.take(254)
                }
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}
