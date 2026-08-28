// memoria screen — menu bar agent (👁🟢 healthy / 👁⚠️ broken / 👁⚪️ off) + one toggle
// ⚠️ = the watcher should be running but the process died, or the memo has not
// been updated for 60s (capture is silently failing, e.g. permissions were lost).
import AppKit
import UserNotifications

let home = FileManager.default.homeDirectoryForCurrentUser
let memoriaHome = ProcessInfo.processInfo.environment["MEMORIA_HOME"].map { URL(fileURLWithPath: $0) }
  ?? home.appendingPathComponent(".memoria")
let outDir = memoriaHome.appendingPathComponent("screen")
let memoURL = outDir.appendingPathComponent("current-activity.md")
let pidURL  = outDir.appendingPathComponent("watcher.pid")
// watch.mjs lives next to the app bundle
let screenDir = URL(fileURLWithPath: Bundle.main.bundlePath).deletingLastPathComponent()
let nodePath: String = {
  for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
    if FileManager.default.isExecutableFile(atPath: p) { return p }
  }
  return "/usr/bin/env"  // fall back to PATH lookup
}()

func notify(_ title: String, _ body: String) {
  let c = UNMutableNotificationContent(); c.title = title; c.body = body; c.sound = .default
  UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
}
func pidAlive(_ pid: Int32) -> Bool { pid > 0 && kill(pid, 0) == 0 }

final class Agent: NSObject, NSApplicationDelegate {
  var item: NSStatusItem!
  var statusLine: NSMenuItem!
  var toggleItem: NSMenuItem!
  var proc: Process?
  var running = false
  var wantRunning = true      // user intent (false only after the toggle is switched off)
  var lastStartAt = Date()    // grace period so a fresh start is not flagged as broken
  var state = ""              // "ok" | "off" | "broken"
  var timer: Timer?

  func applicationDidFinishLaunching(_ n: Notification) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let m = NSMenu()
    let head = NSMenuItem(title: "memoria screen", action: nil, keyEquivalent: ""); head.isEnabled = false
    m.addItem(head)
    statusLine = NSMenuItem(title: "status: checking…", action: nil, keyEquivalent: ""); statusLine.isEnabled = false
    m.addItem(statusLine)
    m.addItem(.separator())
    toggleItem = NSMenuItem(title: "toggle", action: #selector(toggleTapped), keyEquivalent: "t")
    toggleItem.target = self
    m.addItem(toggleItem)
    m.addItem(.separator())
    m.addItem(withTitle: "open memo", action: #selector(openMemo), keyEquivalent: "o").target = self
    m.addItem(withTitle: "quit", action: #selector(quitTapped), keyEquivalent: "q").target = self
    item.menu = m
    startWatcher()                 // on by default at launch
    render()
    timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.tick() }
  }

  func startWatcher() {
    wantRunning = true
    lastStartAt = Date()
    if isAlive() { return }
    let p = Process()
    let script = screenDir.appendingPathComponent("watch.mjs").path
    if nodePath == "/usr/bin/env" {
      p.executableURL = URL(fileURLWithPath: nodePath)
      p.arguments = ["node", script]
    } else {
      p.executableURL = URL(fileURLWithPath: nodePath)
      p.arguments = [script]
    }
    p.currentDirectoryURL = screenDir
    var env = ProcessInfo.processInfo.environment
    env["SAMPLES"] = "0"; env["INTERVAL"] = env["INTERVAL"] ?? "2000"
    p.environment = env
    do { try p.run(); proc = p
      try? String(p.processIdentifier).write(to: pidURL, atomically: true, encoding: .utf8)
      setRunning(true)
    } catch { setRunning(false) }
  }
  func stopWatcher() {
    wantRunning = false
    if let p = proc, p.isRunning { p.terminate() }
    if let s = try? String(contentsOf: pidURL, encoding: .utf8), let pid = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)), pidAlive(pid) { kill(pid, SIGTERM) }
    try? FileManager.default.removeItem(at: pidURL)
    proc = nil
    setRunning(false)
  }
  func isAlive() -> Bool {
    if let p = proc, p.isRunning { return true }
    if let s = try? String(contentsOf: pidURL, encoding: .utf8), let pid = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)) { return pidAlive(pid) }
    return false
  }
  func setRunning(_ v: Bool) {
    running = v
    refreshState()
  }
  func tick() { running = isAlive(); refreshState() }

  func memoAge() -> TimeInterval? {
    guard let a = try? FileManager.default.attributesOfItem(atPath: memoURL.path),
          let mt = a[.modificationDate] as? Date else { return nil }
    return Date().timeIntervalSince(mt)
  }
  func currentState() -> String {
    if !wantRunning { return "off" }
    if !running { return "broken" }
    let inGrace = Date().timeIntervalSince(lastStartAt) < 30
    if !inGrace, let age = memoAge(), age > 60 { return "broken" }
    return "ok"
  }
  func refreshState() {
    let s = currentState()
    if s != state {
      let old = state
      state = s
      if old != "" || s != "ok" {  // don't notify on the first healthy start
        switch s {
        case "ok":     notify("Screen memory started", "memoria is watching your displays")
        case "off":    notify("Screen memory stopped", "watching is off")
        default:       notify("⚠️ memoria is not running properly", running ? "the process is alive but the memo is not updating (check permissions)" : "the watcher process died")
        }
      }
    }
    render()
  }

  func render() {
    if let b = item.button {
      switch state {
      case "ok":  b.title = "👁🟢"
      case "off": b.title = "👁⚪️"
      default:    b.title = "👁⚠️"
      }
    }
    if let t = toggleItem { t.title = wantRunning ? "■ stop watching" : "▶ start watching" }
    var s: String
    switch state {
    case "ok":  s = "status: watching"
    case "off": s = "status: stopped"
    default:    s = running ? "status: broken (memo not updating)" : "status: broken (process died)"
    }
    if let age = memoAge() { s += String(format: " (updated %.0fs ago)", age) }
    statusLine?.title = s
  }

  @objc func toggleTapped() { if wantRunning { stopWatcher() } else { startWatcher() } }
  @objc func openMemo() { NSWorkspace.shared.open(memoURL) }
  @objc func quitTapped() { stopWatcher(); NSApp.terminate(nil) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let agent = Agent()
app.delegate = agent
app.run()
