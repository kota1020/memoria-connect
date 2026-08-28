// memoria screen — extract the definite on-screen text of a window from its AX tree
// usage: axread <pid> [x] [y]   (x,y pick the window closest to that origin)
import ApplicationServices
import Foundation

let a = CommandLine.arguments
guard a.count >= 2, let pid = Int32(a[1]) else { exit(1) }
let wantX = a.count > 2 ? (Double(a[2]) ?? -1e9) : -1e9
let wantY = a.count > 3 ? (Double(a[3]) ?? -1e9) : -1e9
let app = AXUIElementCreateApplication(pid)

func attr(_ el: AXUIElement, _ k: String) -> CFTypeRef? {
  var v: CFTypeRef?
  return AXUIElementCopyAttributeValue(el, k as CFString, &v) == .success ? v : nil
}
func posOf(_ w: AXUIElement) -> (Double, Double) {
  guard let p = attr(w, kAXPositionAttribute as String), CFGetTypeID(p) == AXValueGetTypeID() else { return (0,0) }
  var pt = CGPoint.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &pt)
  return (Double(pt.x), Double(pt.y))
}
var windows = (attr(app, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
var target = windows.first
if wantX > -1e9, !windows.isEmpty {
  target = windows.min { l, r in
    let (lx,ly) = posOf(l), (rx,ry) = posOf(r)
    return abs(lx-wantX)+abs(ly-wantY) < abs(rx-wantX)+abs(ry-wantY)
  }
}
guard let win = target else { exit(0) }

var lines: [String] = []
var nodes = 0
func walk(_ el: AXUIElement, _ depth: Int) {
  if nodes > 600 || depth > 25 || lines.count > 250 { return }
  nodes += 1
  for k in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
    if let s = attr(el, k as String) as? String {
      let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
      if t.count >= 2 && t.count < 400 { lines.append(t) }
    }
  }
  if let kids = attr(el, kAXChildrenAttribute as String) as? [AXUIElement] {
    for c in kids { walk(c, depth+1) }
  }
}
walk(win, 0)
var seen = Set<String>(); var uniq: [String] = []
for s in lines where !seen.contains(s) { seen.insert(s); uniq.append(s) }
var text = uniq.joined(separator: " · ")
if text.count > 3000 { text = String(text.prefix(3000)) + "…" }
print(text)
