import XCTest
@testable import Dudu

final class PhoneNetworkTests: XCTestCase {
    private func interface(_ name: String, _ address: String) -> PhoneNetwork.Interface { .init(name: name, address: address) }

    func testTheNetworkThePhoneReachesTheComputerByIsWifiThenCellularThenAWire() {
        let wifi = interface("en0", "192.168.31.88"), cellular = interface("pdp_ip0", "10.64.12.7"), wire = interface("en2", "172.20.10.2")
        XCTAssertEqual(PhoneNetwork.from(interfaces: [cellular, wifi, wire]), PhoneNetwork(kind: .wifi, address: "192.168.31.88"))
        XCTAssertEqual(PhoneNetwork.from(interfaces: [wire, cellular]), PhoneNetwork(kind: .cellular, address: "10.64.12.7"))
        XCTAssertEqual(PhoneNetwork.from(interfaces: [wire]), PhoneNetwork(kind: .other, address: "172.20.10.2"))
        XCTAssertNil(PhoneNetwork.from(interfaces: [interface("utun3", "100.64.0.2"), interface("awdl0", "169.254.1.1"), interface("bridge100", "192.0.0.1")]), "a tunnel or a bridge is not the phone's own address")
        XCTAssertNil(PhoneNetwork.from(interfaces: []))
    }

    func testTheLineUnderTheCard() {
        XCTAssertEqual(PhoneNetwork(kind: .wifi, address: "192.168.31.88").footnote, "\(L10n.text("本机")) · Wi-Fi · 192.168.31.88")
        XCTAssertEqual(PhoneNetwork(kind: .cellular, address: "10.64.12.7").footnote, "\(L10n.text("本机")) · \(L10n.text("蜂窝网络")) · 10.64.12.7")
        XCTAssertEqual(PhoneNetwork(kind: .other, address: "172.20.10.2").footnote, "\(L10n.text("本机")) · 172.20.10.2")
    }
}
