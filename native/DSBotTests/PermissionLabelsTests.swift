import XCTest
@testable import dsbot

final class PermissionLabelsTests: XCTestCase {
    private func localized(_ id: String, _ name: String) -> String {
        PermissionLabels.localized(Choice(id: id, name: name)).name
    }

    func testBuiltInPresetsGetDSHsChineseNames() {
        XCTAssertEqual(localized("read-only", "read-only"), "仅可查看")
        XCTAssertEqual(localized("workspace-write", "workspace-write"), "工作区内修改")
        XCTAssertEqual(localized("danger-full-access", "danger-full-access"), "完全权限")
        XCTAssertEqual(localized("auto", "auto"), "自动审查")
    }

    func testStockEnglishLabelsAreReplacedToo() {
        XCTAssertEqual(localized("read-only", "Read Only"), "仅可查看")
        XCTAssertEqual(localized("workspace-write", "Workspace Write"), "工作区内修改")
        XCTAssertEqual(localized("danger-full-access", "Full access"), "完全权限")
    }

    func testNamesTheHostChoseAreKept() {
        XCTAssertEqual(localized("read-only", "我的只读"), "我的只读")
        XCTAssertEqual(localized("ask", "操作前询问"), "操作前询问")
        XCTAssertEqual(localized("danger-full-access", "Everything allowed"), "Everything allowed")
    }

    func testOtherKebabCaseNamesAreTitleCased() {
        XCTAssertEqual(localized("review-first", "review-first"), "Review First")
        XCTAssertEqual(localized("solo", "solo"), "Solo")
    }

    func testLocalizingKeepsTheRestOfTheChoice() {
        let choice = Choice(id: "read-only", name: "read-only", description: "d", isDefault: true)
        let result = PermissionLabels.localized(choice)

        XCTAssertEqual(result.id, "read-only")
        XCTAssertEqual(result.description, "d")
        XCTAssertEqual(result.isDefault, true)
    }

    func testOnlyThePresetsThatReduceConfirmationsAskFirst() {
        XCTAssertNil(PermissionLabels.confirmation(for: "read-only"))
        XCTAssertNil(PermissionLabels.confirmation(for: "workspace-write"))
        XCTAssertNil(PermissionLabels.confirmation(for: "ask"))
        XCTAssertEqual(PermissionLabels.confirmation(for: "danger-full-access")?.title, "确认启用完全权限？")
        XCTAssertEqual(PermissionLabels.confirmation(for: "danger-full-access")?.action, "启用完全权限")
        XCTAssertEqual(PermissionLabels.confirmation(for: "auto")?.title, "确认启用自动审查（实验）？")
    }

    func testChoicesDecodeWithAndWithoutTheNewFields() throws {
        let plain = try JSONDecoder().decode(Choice.self, from: Data(#"{"id":"deepseek","name":"DeepSeek"}"#.utf8))
        XCTAssertNil(plain.efforts)
        XCTAssertNil(plain.defaultEffort)

        let rich = try JSONDecoder().decode(Choice.self, from: Data(
            #"{"id":"m","name":"M","efforts":[{"id":"high","name":"High"},{"id":"max","name":"Max"}],"defaultEffort":"high"}"#.utf8
        ))
        XCTAssertEqual(rich.efforts?.map(\.id), ["high", "max"])
        XCTAssertEqual(rich.defaultEffort, "high")

        let preset = try JSONDecoder().decode(Choice.self, from: Data(
            #"{"id":"standard","name":"标准模式","description":"处理代码、文件和资料。","isDefault":true}"#.utf8
        ))
        XCTAssertEqual(preset.isDefault, true)
        XCTAssertEqual(preset.description, "处理代码、文件和资料。")
    }

    func testSessionDetailReadsEffortAndPreset() throws {
        let json = """
        {"session":{"id":"s","title":"t","updatedAt":1,"status":"idle"},"messages":[],
         "modelId":"deepseek:v4","reasoningEffort":"max","agentPreset":"minimal"}
        """
        let detail = try JSONDecoder().decode(SessionDetail.self, from: Data(json.utf8))

        XCTAssertEqual(detail.reasoningEffort, "max")
        XCTAssertEqual(detail.agentPreset, "minimal")
        XCTAssertEqual(detail.modelId, "deepseek:v4")
    }
}
