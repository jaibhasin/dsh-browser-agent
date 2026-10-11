import AppKit
import SwiftUI

@MainActor
final class AgentModel: ObservableObject {
    @Published var state = "starting"
    @Published var message = "Starting your browser agent..."
    @Published var ready = false
    var settingsURL = "http://127.0.0.1:3080"
    var process: Process?
    var input: Pipe?
    var output: Pipe?
    var buffer = ""
    var quitting = false
    var onChange: (() -> Void)?
    var onExit: (() -> Void)?

    var busy: Bool { state == "starting" || state == "stopping" }
    var title: String {
        switch state {
        case "ready": return "Ready for Chrome"
        case "starting": return "Getting ready"
        case "stopping": return "Stopping agent"
        case "stopped": return "Taking a break"
        default: return "Needs attention"
        }
    }
    var logURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/DSH Browser Agent/agent.log")
    }
    func launch() {
        guard let resources = Bundle.main.resourceURL else { return }
        let task = Process()
        let stdin = Pipe(), stdout = Pipe()
        input = stdin; output = stdout; process = task
        task.executableURL = resources.appendingPathComponent("node")
        task.arguments = [resources.appendingPathComponent("supervisor.mjs").path,
                          resources.appendingPathComponent("launcher.json").path]
        task.standardInput = stdin
        task.standardOutput = stdout
        task.standardError = FileHandle.nullDevice
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.receive(chunk) }
        }
        task.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.output?.fileHandleForReading.readabilityHandler = nil
                if self.quitting { self.onExit?() }
                else {
                    self.state = "error"; self.ready = false
                    self.message = "The launcher stopped. Quit and reopen the app to try again."
                    self.onChange?()
                }
            }
        }
        do { try task.run() }
        catch {
            state = "error"; message = "The launcher could not start. Reinstall the app and try again."
            onChange?()
        }
    }
    func receive(_ chunk: String) {
        buffer += chunk
        while let newline = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<newline])
            buffer.removeSubrange(...newline)
            guard let data = line.data(using: .utf8),
                  let status = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            state = status["state"] as? String ?? "error"
            message = status["message"] as? String ?? "Open the logs for more details."
            ready = status["ready"] as? Bool ?? false
            settingsURL = status["settingsURL"] as? String ?? settingsURL
            onChange?()
        }
    }
    func send(_ command: String) {
        guard process?.isRunning == true else { return }
        try? input?.fileHandleForWriting.write(contentsOf: Data((command + "\n").utf8))
    }
    func toggle() { send(state == "ready" || state == "error" ? "stop" : "start") }
    func openChrome() {
        let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome")
        if let chrome {
            NSWorkspace.shared.openApplication(at: chrome, configuration: NSWorkspace.OpenConfiguration())
        } else { NSWorkspace.shared.open(URL(string: "https://www.google.com/chrome/")!) }
    }
    func openSettings() { if let url = URL(string: settingsURL), ready { NSWorkspace.shared.open(url) } }
    func openLogs() {
        if FileManager.default.fileExists(atPath: logURL.path) { NSWorkspace.shared.open(logURL) }
        else { NSWorkspace.shared.open(logURL.deletingLastPathComponent()) }
    }
}

struct AgentView: View {
    @ObservedObject var model: AgentModel
    let accent = Color(red: 0.38, green: 0.85, blue: 0.96)
    var statusColor: Color { model.ready ? Color(red: 0.46, green: 0.89, blue: 0.69) : (model.state == "error" ? .orange : accent) }
    var body: some View {
        VStack(alignment: .leading, spacing: 26) {
            HStack(spacing: 13) {
                Image(systemName: "cursorarrow.rays")
                    .font(.system(size: 26, weight: .medium)).foregroundStyle(accent)
                    .frame(width: 56, height: 56)
                    .background(accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(accent.opacity(0.22)))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Browser Agent").font(.system(size: 20, weight: .semibold))
                    Text("DSH ON YOUR MAC").font(.system(size: 10, weight: .medium, design: .monospaced)).tracking(2).foregroundStyle(.white.opacity(0.42))
                }
                Spacer()
            }
            VStack(alignment: .leading, spacing: 15) {
                HStack(spacing: 8) {
                    Circle().fill(statusColor).frame(width: 7, height: 7)
                    Text(model.ready ? "ALL SYSTEMS READY" : model.busy ? "ONE MOMENT" : model.state == "stopped" ? "AGENT STOPPED" : "CHECK YOUR AGENT")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced)).tracking(1.4).foregroundStyle(statusColor)
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                }
                Text(model.title).font(.system(size: 32, weight: .semibold)).tracking(-0.8)
                Text(model.message).font(.system(size: 14)).foregroundStyle(.white.opacity(0.58)).lineSpacing(4).frame(height: 43, alignment: .topLeading)
                Divider().overlay(.white.opacity(0.07))
                serviceRow("sparkles", "Agent runtime", model.ready ? "Running" : model.busy ? "Working..." : "Stopped")
                serviceRow("link", "Chrome connection", model.ready ? "Available" : "Waiting")
            }
            .padding(24)
            .background(.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.075)))
            VStack(alignment: .leading, spacing: 10) {
                Text("YOUR NEXT STEP").font(.system(size: 10, weight: .medium, design: .monospaced)).tracking(1.5).foregroundStyle(.white.opacity(0.38))
                HStack(alignment: .top, spacing: 11) {
                    Image(systemName: "puzzlepiece.extension").font(.system(size: 18)).foregroundStyle(accent).padding(.top, 2)
                    Text("Click **dsh Browser Agent** in Chrome’s Extensions menu, then start chatting.")
                        .font(.system(size: 13)).foregroundStyle(.white.opacity(0.67)).lineSpacing(4)
                }
            }
            HStack(spacing: 10) {
                Button(action: model.ready ? model.openChrome : { model.send("start") }) {
                    HStack(spacing: 8) {
                        Image(systemName: model.ready ? "arrow.up.right" : "play.fill")
                        Text(model.ready ? "Open Chrome" : "Start agent")
                    }.font(.system(size: 13, weight: .semibold)).frame(maxWidth: .infinity).frame(height: 42)
                }
                .buttonStyle(.plain).foregroundStyle(Color(red: 0.04, green: 0.10, blue: 0.15))
                .background(accent.opacity(model.busy ? 0.35 : 1), in: RoundedRectangle(cornerRadius: 11))
                .disabled(model.busy || model.state == "error")
                Button(action: { model.send("stop") }) {
                    Text(model.state == "error" ? "Reset agent" : "Stop agent")
                        .font(.system(size: 13, weight: .medium)).frame(width: 112, height: 42)
                }
                .buttonStyle(.plain).foregroundStyle(.white.opacity(0.75))
                .background(.white.opacity(0.065), in: RoundedRectangle(cornerRadius: 11))
                .disabled(model.busy || model.state == "stopped")
            }
            HStack(spacing: 16) {
                Button("Agent settings", action: model.openSettings).disabled(!model.ready)
                Button("View logs", action: model.openLogs)
                Spacer()
                Text("Runs locally on your Mac").font(.system(size: 10)).foregroundStyle(.white.opacity(0.3))
            }.font(.system(size: 11)).buttonStyle(.plain).foregroundStyle(.white.opacity(0.48))
        }
        .padding(30).padding(.top, 8)
        .foregroundStyle(.white)
        .frame(width: 500, height: 640)
        .background(LinearGradient(colors: [Color(red: 0.07, green: 0.11, blue: 0.17), Color(red: 0.035, green: 0.055, blue: 0.085)], startPoint: .topLeading, endPoint: .bottomTrailing))
        .preferredColorScheme(.dark)
    }
    func serviceRow(_ icon: String, _ name: String, _ value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).frame(width: 16).foregroundStyle(.white.opacity(0.42))
            Text(name).foregroundStyle(.white.opacity(0.68))
            Spacer()
            Text(value).foregroundStyle(model.ready ? statusColor : .white.opacity(0.38))
        }.font(.system(size: 12))
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    let model = AgentModel()
    var window: NSWindow!
    var statusItem: NSStatusItem!
    var terminationPending = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Browser Agent", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Browser Agent", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let root = NSMenuItem(); root.submenu = appMenu; menu.addItem(root)
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 640), styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Browser Agent"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = NSHostingView(rootView: AgentView(model: model))
        window.center()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "cursorarrow.rays", accessibilityDescription: "Browser Agent")
        model.onChange = { [weak self] in self?.updateMenu() }
        model.onExit = { [weak self] in
            guard self?.terminationPending == true else { return }
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        updateMenu(); showWindow(); model.launch()
    }
    func updateMenu() {
        let menu = NSMenu()
        let status = menu.addItem(withTitle: model.title, action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(.separator())
        menu.addItem(withTitle: "Show Browser Agent", action: #selector(showWindow), keyEquivalent: "").target = self
        if !model.busy {
            menu.addItem(withTitle: model.ready || model.state == "error" ? "Stop agent" : "Start agent", action: #selector(toggleAgent), keyEquivalent: "").target = self
        }
        menu.addItem(withTitle: "Quit Browser Agent", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
    }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func toggleAgent() { model.toggle() }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard model.process?.isRunning == true else { return .terminateNow }
        if !terminationPending {
            terminationPending = true; model.quitting = true; model.send("quit")
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                guard self?.model.process?.isRunning == true else { return }
                self?.model.process?.terminate()
            }
        }
        return .terminateLater
    }
}

@main
struct BrowserAgentApplication {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
