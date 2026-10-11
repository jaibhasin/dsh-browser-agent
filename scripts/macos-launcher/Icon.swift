import AppKit

let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
let rect = NSRect(x: 32, y: 32, width: 960, height: 960)
let path = NSBezierPath(roundedRect: rect, xRadius: 220, yRadius: 220)
NSGradient(starting: NSColor(srgbRed: 0.12, green: 0.21, blue: 0.32, alpha: 1), ending: NSColor(srgbRed: 0.035, green: 0.065, blue: 0.11, alpha: 1))!.draw(in: path, angle: -90)
NSColor(srgbRed: 0.38, green: 0.85, blue: 0.96, alpha: 0.16).setFill()
NSBezierPath(ovalIn: NSRect(x: 162, y: 162, width: 700, height: 700)).fill()
let symbol = NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: nil)!
let config = NSImage.SymbolConfiguration(pointSize: 480, weight: .medium).applying(NSImage.SymbolConfiguration(paletteColors: [NSColor(srgbRed: 0.44, green: 0.90, blue: 0.98, alpha: 1)]))
let tinted = symbol.withSymbolConfiguration(config)!
tinted.draw(in: NSRect(x: 248, y: 248, width: 528, height: 528))
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
