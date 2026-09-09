/**
 * Slash command palette - a compact dropdown that appears when the user types "/".
 *
 * Architecture:
 *   - Visibility is derived straight from the composer prompt (no extra state),
 *     so the palette follows every keystroke as the user types a command.
 *   - The parent filters `commands` against what's typed; `activeId` marks the
 *     best match, which is highlighted and executed when Enter is pressed.
 *   - Clicking a row calls `onExecute`, which runs the command and clears the prompt.
 */
export function SlashCommandPalette({
  visible,
  commands,
  activeId,
  onExecute,
  title = "Commands",
  ariaLabel = "Slash commands",
}: {
  visible: boolean;
  commands: readonly { id: string; label: string; description: string }[];
  activeId?: string;
  onExecute: (id: string) => void;
  title?: string;
  ariaLabel?: string;
}) {
  if (!visible) return null;

  return (
    <div className="slash-command-palette" role="listbox" aria-label={ariaLabel}>
      <div className="slash-command-header">{title}</div>
      {commands.length === 0 ? (
        <p className="slash-command-empty">No matching commands.</p>
      ) : (
        <ul className="slash-command-list">
          {commands.map((cmd) => {
            const active = cmd.id === activeId;
            return (
              <li
                key={cmd.id}
                className={`slash-command-item${active ? " slash-command-item-active" : ""}`}
                role="option"
                aria-selected={active}
                onClick={() => onExecute(cmd.id)}
              >
                <span className="slash-command-label">{cmd.label}</span>
                <span className="slash-command-desc">{cmd.description}</span>
                {active && <kbd className="slash-command-kbd" aria-hidden="true">↵</kbd>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
