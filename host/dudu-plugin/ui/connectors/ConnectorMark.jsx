import { ConnectorAvatar } from '../collector/ConnectorAvatar.jsx';
import { ICONS } from './icons.js';
import { Tile } from './Tile.jsx';

/**
 * A connector's picture in its rows and on its page: the service's logo, or the plain symbol a catalog item ships with (a globe for the browser, a pen for Pencil); a
 * connector with neither, which is every one the owner added by hand or that was found on this computer, gets the first letter of its name on a soft colour, as the
 * Collector and the phone draw it (owner, 2026-11-12, on "QQ 邮箱" wearing QQ's logo: "要么就换成邮箱头像，要么就用开头第一个字母生成头像"). The tile keeps the corner
 * radius of the logo tiles beside it, whatever its size.
 */
export function ConnectorMark({ icon, name, size = 36 }) {
  const shown = ICONS[icon];
  if (shown) return <Tile icon={shown} size={size} />;
  return <ConnectorAvatar icon={null} name={name} size={size} radius={10} />;
}
