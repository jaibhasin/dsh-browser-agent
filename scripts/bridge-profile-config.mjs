import { isMap, isSeq, parseDocument } from 'yaml';

/** Upsert this plugin's identity while preserving other entries, comments and !!js tags.
 * JavaScript tags remain inert text; the installer never evaluates configuration code.
 */
export function upsertBridgeIdentityPatch(source, extensionId, token) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid bridge extension ID.');
  const document = parseDocument(source.trim() ? source : '[]', {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }],
  });
  if (document.errors.length) throw new Error(`Invalid cordis.patch.yml: ${document.errors[0].message}`);
  if (!document.contents) document.contents = document.createNode([]);
  if (!isSeq(document.contents)) throw new Error('cordis.patch.yml must contain a list of plugin entries.');
  const entries = document.contents.items;
  if (entries.some(entry => !isMap(entry))) throw new Error('Each cordis.patch.yml plugin entry must be a mapping.');
  const matches = entries.filter(entry => entry.get('id') === 'dsh-browser-agent');
  if (matches.length > 1) throw new Error('Duplicate dsh-browser-agent entries in cordis.patch.yml.');
  const entry = matches[0];
  if (!entry) {
    if (!entries.length) document.contents.flow = false;
    document.contents.add(document.createNode({ id: 'dsh-browser-agent', config: { token, extensionId, port: 7331 } }));
  } else {
    let config = entry.get('config', true);
    if (!config || config.value === null) {
      config = document.createNode({ token, port: 7331 });
      entry.set('config', config);
    }
    if (!isMap(config)) throw new Error('dsh-browser-agent config must be a mapping, not an alias or scalar.');
    // A repeat install with a matching identity should leave the file byte-for-byte intact.
    const identityNode = config.get('extensionId', true);
    if (identityNode?.value === extensionId && !identityNode.tag) return source;
    config.set('extensionId', document.createNode(extensionId));
  }
  const output = document.toString();
  return source.includes('\r\n') ? output.replace(/\n/g, '\r\n') : output;
}
