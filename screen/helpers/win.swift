// memoria screen — list visible windows on all displays as JSON (CoreGraphics only)
import CoreGraphics
import Foundation

var count: UInt32 = 0
CGGetActiveDisplayList(0, nil, &count)
var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
CGGetActiveDisplayList(count, &ids, &count)
let sorted = ids.map { ($0, CGDisplayBounds($0)) }.sorted { $0.1.origin.x < $1.1.origin.x }
let displays = sorted.enumerated().map { (i, e) -> (Int, CGRect, Bool) in (i, e.1, CGDisplayIsMain(e.0) != 0) }
func labelFor(_ i: Int) -> String {
  if displays.count <= 1 { return "monitor" }
  if i == 0 { return "left monitor" }
  if i == displays.count - 1 { return "right monitor" }
  return "monitor \(i)"
}
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let info = (CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]]) ?? []
var out: [[String: Any]] = []
for (zIndex, w) in info.enumerated() {
  guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
  let app = w[kCGWindowOwnerName as String] as? String ?? ""
  let title = w[kCGWindowName as String] as? String ?? ""
  let pid = w[kCGWindowOwnerPID as String] as? Int ?? 0
  let num = w[kCGWindowNumber as String] as? Int ?? 0
  guard let b = w[kCGWindowBounds as String] as? [String: CGFloat],
        let x = b["X"], let y = b["Y"], let ww = b["Width"], let hh = b["Height"] else { continue }
  if ww < 120 || hh < 120 { continue }
  let center = CGPoint(x: x + ww/2, y: y + hh/2)
  var disp = 0
  for (i, r, _) in displays where r.contains(center) { disp = i }
  out.append(["display": disp, "monitor": labelFor(disp), "app": app, "title": title,
              "pid": pid, "num": num, "z": zIndex, "x": Int(x), "y": Int(y), "w": Int(ww), "h": Int(hh), "area": Int(ww*hh)])
}
let payload: [String: Any] = [
  "idleSeconds": CGEventSource.secondsSinceLastEventType(
    .combinedSessionState,
    eventType: CGEventType(rawValue: UInt32.max)!
  ),
  "displays": displays.map { ["index": $0.0, "label": labelFor($0.0), "main": $0.2, "w": Int($0.1.width), "h": Int($0.1.height)] },
  "windows": out
]
print(String(data: try! JSONSerialization.data(withJSONObject: payload), encoding: .utf8)!)
