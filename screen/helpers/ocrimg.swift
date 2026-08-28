// memoria screen — OCR one image with Apple Vision. usage: ocrimg <imagePath>
import Foundation
import Vision
import AppKit

let a = CommandLine.arguments
guard a.count >= 2 else { exit(1) }
guard let img = NSImage(contentsOfFile: a[1]),
      let tiff = img.tiffRepresentation,
      let bmp = NSBitmapImageRep(data: tiff),
      let cg = bmp.cgImage else { exit(0) }
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate          // .fast does not support CJK
req.usesLanguageCorrection = false
if let langs = try? req.supportedRecognitionLanguages() {
  req.recognitionLanguages = langs        // recognize every language Vision supports
}
do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch { exit(0) }
let results = req.results ?? []
var lines: [String] = []
for obs in results {
  let cands = obs.topCandidates(1)
  if let c = cands.first { lines.append(c.string) }
}
var text = lines.joined(separator: " · ")
if text.count > 3000 { text = String(text.prefix(3000)) + "…" }
print(text)
