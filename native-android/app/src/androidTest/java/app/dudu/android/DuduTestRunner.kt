package app.dudu.android

import android.app.LocaleManager
import android.os.Build
import android.os.Bundle
import android.os.LocaleList
import androidx.test.runner.AndroidJUnitRunner

class DuduTestRunner : AndroidJUnitRunner() {
    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        if (Build.VERSION.SDK_INT >= 33) {
            targetContext.getSystemService(LocaleManager::class.java).applicationLocales =
                LocaleList.forLanguageTags(arguments?.getString("language") ?: "zh-CN")
        }
    }
}
